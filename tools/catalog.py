#!/usr/bin/env python3
"""Build or serve the small, curated gas catalogue; Python standard library only."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from . import build_gas_index as legacy
except ImportError:
    import build_gas_index as legacy

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path("catalog/gases.json")
REPORT = Path("catalog/report.json")
SUPPORTED = {11, 12, 13}


def safe_path(root, relative):
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or "\\" in relative or "?" in relative or "#" in relative:
        raise ValueError("必须使用仓库内的相对路径")
    full = (root / path).resolve()
    full.relative_to(root.resolve())
    return full


def close(a, b):
    return math.isclose(a, b, rel_tol=1e-7, abs_tol=1e-7)


def fractions_match_identifier(fractions, identifier, declared):
    """Allow only half a displayed decimal place for rounded percent labels."""
    tokens = []
    composition = re.split(r",\s*T\s*=|,\s*p\s*=", identifier, maxsplit=1, flags=re.I)[0]
    for part in composition.split(','):
        match = legacy.COMPONENT_RE.match(part)
        if match:
            token = match[2]
            decimals = len(token.split('.')[1]) if '.' in token else 0
            tokens.append((float(token), 0.5 * 10 ** -decimals))
    tokens.sort()
    if len(fractions) != len(declared):
        return False
    if len(tokens) != len(declared):
        return all(close(a, b) for a, b in zip(fractions, declared))
    return all(abs(a - b) <= tolerance + 1e-10
               for a, (b, tolerance) in zip(fractions, tokens))


def required_number(text, key):
    match = re.search(r"\b" + key + r"\s*=\s*(" + legacy.FLOAT_TOKEN_RE.pattern + r")", text)
    if not match:
        raise ValueError("缺少 " + key + "，不使用默认温压代替")
    value = legacy.parse_float_tokens(match.group(1))[0]
    if not math.isfinite(value) or value <= 0:
        raise ValueError(key + " 必须为有限正数")
    return value


def component_order(name):
    noble = ["he", "ne", "ar", "kr", "xe", "rn", "og"]
    return (noble.index(name.lower()) if name.lower() in noble else len(noble), name.lower())


def family_directory(names):
    names = sorted(names, key=component_order)
    noble = [name for name in names if name.lower() in {"he", "ne", "ar", "kr", "xe", "rn", "og"}]
    base = noble[0] if noble else "X"
    variables = ["X", "Y", "Z"] if noble else ["Y", "Z", "W"]
    category = "Pure" if len(names) == 1 else "+".join([base] + variables[:len(names)-1])
    if len(names) > 4:
        category = base + "+Mix"
    return str(Path("GasDataBase") / category / "_".join(names))


def inspect_gas(text, filename, aliases):
    marker = re.search(r"The gas tables follow:\s*", text, re.I)
    end = re.search(r"^\s*H\s+Extr\s*:", text, re.M | re.I)
    if not marker or not end or marker.end() >= end.start():
        raise ValueError("缺少气体表或页脚标记")
    header, footer = text[:marker.start()], text[end.start():]
    dim = legacy.DIMENSION_RE.search(header)
    version = legacy.VERSION_RE.search(header)
    bits = legacy.GASOK_RE.search(header)
    if not dim or not version or int(version[1]) not in SUPPORTED or not bits or len(bits[1]) < 16:
        raise ValueError("不支持的格式版本，或 Dimension / GASOK 信息不完整")
    ne, na, nb, nx, ni = (int(dim[i]) for i in range(2, 7))
    if min(ne, na, nb) < 1:
        raise ValueError("电场、磁场和夹角网格不能为空")
    ep = legacy.extract_grid_values(header, r"\bE\s+fields\b", r"\bE-B\s+angles\b", ne)
    angles = legacy.extract_grid_values(header, r"\bE-B\s+angles\b", r"\bB\s+fields\b", na)
    fields = legacy.extract_grid_values(header, r"\bB\s+fields\b", r"\bMixture\s*:", nb)
    for values, count, label in [(ep, ne, "E/p"), (angles, na, "夹角"), (fields, nb, "磁场")]:
        if len(values) != count or any(not math.isfinite(v) or v < 0 for v in values):
            raise ValueError(label + "网格不完整或有非法数值")
        if any(a >= b for a, b in zip(values, values[1:])):
            raise ValueError(label + "网格必须严格递增")
    if any(a > math.pi + 1e-7 for a in angles):
        raise ValueError("夹角超出 0–π")
    values = legacy.parse_float_tokens(text[marker.end():end.start()])
    base = 17 + nx + ni if dim[1] == "T" else 33 + 2 * (nx + ni)
    count = ne * na * nb
    extra = len(values) - base * count
    if extra < 0 or extra % count or any(not math.isfinite(v) for v in values):
        raise ValueError("气体表记录长度不符或存在非有限数值")
    if len(re.findall(r"^\s*Excitation\s+\d+\s*:", header, re.M | re.I)) != nx:
        raise ValueError("激发通道数与 Dimension 不符")
    if len(re.findall(r"^\s*Ionisation\s+\d+\s*:", header, re.M | re.I)) != ni:
        raise ValueError("电离通道数与 Dimension 不符")
    pressure, temperature = required_number(footer, "PGAS"), required_number(footer, "TGAS")
    parsed = legacy.parse_identifier(text, aliases)
    components = sorted(parsed["components"], key=lambda c: component_order(c["name"]))
    if not components or any(c["fraction"] is None or not 0 < c["fraction"] <= 100 for c in components):
        raise ValueError("无法确认有效的气体组分及比例")
    if not math.isclose(sum(c["fraction"] for c in components), 100, abs_tol=.05):
        raise ValueError("组分比例总和不为 100%")
    warnings = []
    it = legacy.parse_temperature_k(parsed["temperature"])
    ip = legacy.parse_pressure_pa(parsed["pressure"])
    if it is not None and not math.isclose(it, temperature, rel_tol=1e-5, abs_tol=.02):
        raise ValueError("Identifier 温度与 TGAS 冲突")
    if ip is not None and not math.isclose(ip, pressure * 101325 / 760, rel_tol=1e-4, abs_tol=1):
        raise ValueError("Identifier 压强与 PGAS 冲突")
    mixture = legacy.MIXTURE_RE.search(text)
    if mixture:
        fractions = sorted(v for v in legacy.parse_float_tokens(mixture[1]) if v > 0)
        declared = sorted(c["fraction"] for c in components)
        if not fractions_match_identifier(fractions, parsed["identifier"], declared):
            raise ValueError("Identifier 比例与 Mixture 比例不一致")
        if any(not close(a, b) for a, b in zip(fractions, declared)):
            warnings.append("Identifier 比例存在显示舍入；与 Mixture 在末位半单位内一致，展示保留 Identifier 比例")
    if extra:
        warnings.append("每条记录含 %d 个未解释扩展值；保留原值供检查" % (extra // count))
    return {
        "identifier": parsed["identifier"], "components": components,
        "family": " / ".join(c["name"] for c in components),
        "label": " / ".join("%s %g%%" % (c["name"], c["fraction"]) for c in components),
        "temperature_k": temperature, "pressure_atm": pressure / 760,
        "pressure_torr": pressure, "format_version": int(version[1]),
        "gasok": bits[1], "electric_fields": [v * pressure for v in ep],
        "e_over_p": ep, "magnetic_fields": [v / 100 for v in fields],
        "angles_deg": [v * 180 / math.pi for v in angles],
        "dimensions": {"electric": ne, "magnetic": nb, "angle": na, "excitation": nx, "ionisation": ni},
        "records": count, "extension_values_per_record": extra // count,
        "warnings": warnings,
    }


def assemble(root):
    config = json.loads((root / "catalog/config.json").read_text(encoding="utf-8"))
    metadata = json.loads((root / "catalog/metadata.json").read_text(encoding="utf-8"))
    if config.get("schema_version") != 1 or metadata.get("schema_version") != 1:
        raise ValueError("配置版本必须为 1")
    aliases, _ = legacy.load_aliases(root / "catalog/gas_aliases.json")
    files, rejected, ignored, duplicates = [], [], [], []
    seen, identities = {}, {}
    all_paths = set()
    collections = config["collections"]
    if not collections or len({c["id"] for c in collections}) != len(collections):
        raise ValueError("集合不能为空且 ID 必须唯一")
    for collection in collections:
        directory = safe_path(root, collection["directory"])
        directory.relative_to((root / "GasDataBase").resolve())
        if not directory.is_dir():
            raise ValueError("集合目录不存在：" + collection["directory"])
        for path in sorted(directory.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            if relative in all_paths:
                continue
            all_paths.add(relative)
            try:
                safe_path(root, relative).relative_to(directory)
                meta = metadata["files"].get(relative, {})
                if set(meta) - {"status", "source", "contributor", "garfield_version", "magboltz_version", "notes"}:
                    raise ValueError("存在不支持的元数据字段")
                status = meta.get("status", "current")
                if status not in {"current", "archived", "excluded"}:
                    raise ValueError("status 必须为 current / archived / excluded")
                if status != "current":
                    ignored.append({"path": relative, "reason": status})
                    continue
                if path.suffix.lower() in {".md", ".pdf", ".json"}:
                    ignored.append({"path": relative, "reason": "非气体资料"})
                    continue
                raw = path.read_bytes()
                text = raw.decode("utf-8")
                if "The gas tables follow:" not in text and path.suffix.lower() != ".gas":
                    ignored.append({"path": relative, "reason": "未识别到气体表标记"})
                    continue
                record = inspect_gas(text, path.name, aliases)
                digest = hashlib.sha256(raw).hexdigest()
                if digest in seen:
                    seen[digest]["alternate_paths"].append(relative)
                    duplicates.append({"path": relative, "same_as": seen[digest]["path"]})
                    continue
                identity = json.dumps([record["components"], record["temperature_k"], record["pressure_atm"], meta.get("garfield_version"), meta.get("magboltz_version")], sort_keys=True)
                if identity in identities:
                    raise ValueError("同配方、温压及已知版本有不同当前文件；请明确合并或在 metadata.json 归档旧文件：" + identities[identity])
                identities[identity] = relative
                name = "_".join("%s-%g" % (re.sub(r"[^A-Za-z0-9().-]", "-", c["name"]), c["fraction"]) for c in record["components"])
                name += "_T%gK_P%gatm.gas" % (record["temperature_k"], record["pressure_atm"])
                profile = config["reference_profile"]
                has_point = lambda values, target: any(close(v, target) for v in values)
                record.update({
                    "id": digest, "sha256": digest, "path": relative, "download_name": name,
                    "collection": collection["id"], "size_bytes": len(raw), "alternate_paths": [],
                    "metadata": {key: meta.get(key) or None for key in ["source", "contributor", "garfield_version", "magboltz_version", "notes"]},
                    "reference_check": {
                        "missing_electric_points": [e for e in profile["electric_fields_v_cm"] if not has_point(record["electric_fields"], e)],
                        "missing_magnetic_points": [b for b in profile["magnetic_fields_t"] if not has_point(record["magnetic_fields"], b)],
                        "angle_matches": all(has_point(record["angles_deg"], a) for a in profile["angles_deg"]),
                        "conditions_match": close(record["temperature_k"], profile["temperature_k"]) and close(record["pressure_atm"], profile["pressure_atm"]),
                    },
                })
                files.append(record)
                seen[digest] = record
            except (ValueError, OSError, UnicodeError) as error:
                rejected.append({"path": relative, "reason": str(error)})
    for path in metadata["files"]:
        if path not in all_paths:
            rejected.append({"path": path, "reason": "元数据路径不在收录目录中或文件不存在"})
    report = {"accepted": len(files), "rejected": rejected, "ignored": ignored, "duplicates": duplicates}
    payload = {"schema_version": 1, "title": config["title"], "collections": collections,
               "reference_profile": config["reference_profile"], "files": files, "summary": report}
    return payload, report


def serialized(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def build(root, check=False):
    payload, report = assemble(root)
    if report["rejected"]:
        for item in report["rejected"]:
            print("拒绝入库：%s — %s" % (item["path"], item["reason"]), file=sys.stderr)
        print("检查失败，保留原目录索引。", file=sys.stderr)
        return 1
    for relative, data in [(OUTPUT, payload), (REPORT, report)]:
        target, expected = root / relative, serialized(data)
        if check:
            if not target.exists() or target.read_text(encoding="utf-8") != expected:
                print("目录需要更新：python3 tools/catalog.py")
                return 1
        else:
            # Only generated files are replaced; gas files and metadata are never rewritten.
            temporary = target.with_suffix(target.suffix + ".tmp")
            temporary.write_text(expected, encoding="utf-8")
            temporary.replace(target)
    print("目录%s：%d 份有效文件，%d 份相同内容，%d 项忽略。" %
          ("检查通过" if check else "已更新", report["accepted"], len(report["duplicates"]), len(report["ignored"])))
    return 0


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true", help="只检查，不写文件")
    parser.add_argument("--serve", action="store_true", help="更新目录后启动本机预览")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    try:
        result = build(args.root.resolve(), args.check)
        if result or not args.serve:
            return result
        server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(args.root.resolve())))
        print("打开 http://127.0.0.1:%d （Ctrl+C 停止）" % args.port, flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print("目录配置或构建失败：" + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
