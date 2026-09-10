(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GasCatalogModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const bits = ['沿 E 漂移速度', '离子迁移率', '纵向扩散', 'Townsend 系数', '簇大小分布',
    '附着系数', 'Lorentz 角', '横向扩散', '沿 B⊥ 漂移速度', '沿 E×B 漂移速度',
    '扩散张量', '离子解离', 'SRIM', 'Heed', '激发速率', '电离速率'];
  const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  const fmt = n => Number.isFinite(n) ? Number(n.toPrecision(7)).toLocaleString('en-US', {maximumSignificantDigits: 7}) : '—';
  const canonical = s => ({'ic4h10': 'iC4H10', 'i-c4h10': 'iC4H10', 'isobutane': 'iC4H10',
    'r134a': 'C2H2F4', 'argon': 'Ar', 'neon': 'Ne', 'cf4': 'CF4', 'ar': 'Ar', 'ne': 'Ne'}[s.trim().toLowerCase()] || s.trim());
  function describe(gas, name) {
    const values = gas.identifier.split(',').map(part => part.trim().match(/^(.+?)\s+([\d.]+)\s*%$/)).filter(Boolean);
    const components = values.map(m => ({name: canonical(m[1]), fraction: Number(m[2])})).sort((a,b) => a.name.localeCompare(b.name));
    return {label: components.length ? components.map(c => `${c.name} ${c.fraction}%`).join(' / ') : name,
      family: components.map(c => c.name).join(' / '), components, identifier: gas.identifier,
      temperature_k: gas.temperature, pressure_atm: gas.pressure / 760, pressure_torr: gas.pressure,
      format_version: gas.version, gasok: gas.gasBits, electric_fields: gas.eOverP.map(e => e * gas.pressure),
      magnetic_fields: gas.bRaw.map(b => b / 100), angles_deg: gas.angles.map(a => a * 180 / Math.PI),
      dimensions: {electric: gas.nE, magnetic: gas.nB, angle: gas.nAngles, excitation: gas.nExc, ionisation: gas.nIon},
      records: gas.records.length, metadata: {}, warnings: components.length ? [] : ['无法确认组分名称；请查看原文件。']};
  }
  function parse(text, name, parser) {
    if (!/\bPGAS\s*=/.test(text) || !/\bTGAS\s*=/.test(text)) throw Error('文件缺少 PGAS / TGAS，无法确认实际温压。');
    const gas = parser.parse(text, name);
    if (![11,12,13].includes(gas.version)) throw Error(`暂不支持格式版本 ${gas.version}，原文件未改动。`);
    if (!(gas.pressure > 0 && gas.temperature > 0) || !Number.isFinite(gas.pressure + gas.temperature)) throw Error('文件温压无效。');
    for (const grid of [gas.eOverP, gas.bRaw, gas.angles]) {
      if (!grid.length || grid.some((v,i) => !Number.isFinite(v) || v < 0 || (i > 0 && v <= grid[i-1]))) throw Error('网格缺失、重复或未递增。');
    }
    if (gas.angles.some(v => v > Math.PI + 1e-7)) throw Error('夹角超出 0–π。');
    return gas;
  }
  function validateQuery(q) {
    if (q.components.some(c => !c.name && c.fraction !== null)) return '请为已填写的比例选择气体。';
    const names = q.components.filter(c => c.name).map(c => c.name);
    if (new Set(names).size !== names.length) return '同一种气体只需填写一次。';
    if (q.components.some(c => c.fraction !== null && (!Number.isFinite(c.fraction) || c.fraction < 0 || c.fraction > 100))) return '比例应在 0–100% 之间。';
    if (q.exactSet && names.length && q.components.filter(c=>c.name).every(c => c.fraction !== null) && Math.abs(q.components.reduce((s,c)=>s+(c.fraction || 0),0)-100) > .05) return '精确组分查询的比例总和应为 100%。';
    if (![q.fractionTolerance, q.temperature, q.pressure, q.b, q.angle, q.minE, q.maxE].every(v => v === null || Number.isFinite(v))) return '请输入有效数值。';
    if (q.temperature !== null && q.temperature <= -273.15) return '温度必须高于绝对零度。';
    if (q.pressure !== null && q.pressure <= 0) return '压强必须大于 0。';
    if ([q.b,q.minE,q.maxE,q.fractionTolerance].some(v => v !== null && v < 0)) return '磁场、电场及容差不能为负数。';
    if (q.angle !== null && (q.angle < 0 || q.angle > 180)) return '夹角应在 0–180° 之间。';
    if (q.minE !== null && q.maxE !== null && q.minE > q.maxE) return '电场起点不能大于终点。';
    return '';
  }
  function match(file, q) {
    const terms = q.text.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const hay = [file.label, file.path, file.family, file.identifier, ...Object.values(file.metadata || {})].join(' ').toLowerCase();
    if (!terms.every(t => hay.includes(t))) return null;
    const components = q.components.filter(c => c.name);
    if (components.some(c => !file.components.some(f => canonical(f.name) === canonical(c.name) &&
        (c.fraction === null || Math.abs(f.fraction-c.fraction) <= q.fractionTolerance + 1e-6)))) return null;
    if (q.exactSet && components.length && file.components.length !== components.length) return null;
    if (q.temperature !== null && !near(file.temperature_k, q.temperature+273.15)) return null;
    if (q.pressure !== null && !near(file.pressure_atm, q.pressure)) return null;
    if (q.b !== null && !file.magnetic_fields.some(b => near(b,q.b))) return null;
    // B=0 has no distinguished E–B angle; retain the file's recorded angle.
    if (q.angle !== null && !(q.b === 0 || (q.b === null && file.magnetic_fields.every(b=>near(b,0)))) &&
        !file.angles_deg.some(a=>near(a,q.angle))) return null;
    const lo=file.electric_fields[0], hi=file.electric_fields[file.electric_fields.length-1];
    const a=q.minE ?? lo, b=q.maxE ?? hi;
    if ((hi < a && !near(hi,a)) || (lo > b && !near(lo,b))) return null;
    const full = (lo <= a || near(lo,a)) && (hi >= b || near(hi,b));
    if (!q.partial && !full) return null;
    return {coverage: full ? '完整覆盖' : '部分覆盖'};
  }
  // Exact component sets rank first; percentages, then pressure and temperature
  // provide deterministic ordering within each recipe family.
  function compareFiles(a,b,q) {
    const requested=q.components.filter(c=>c.name).map(c=>({...c,name:canonical(c.name)}));
    const components=f=>[...f.components].map(c=>({...c,name:canonical(c.name)})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
    const ac=components(a),bc=components(b);
    const exact=cs=>requested.length>0&&cs.length===requested.length&&requested.every(c=>cs.some(v=>v.name===c.name));
    const setOrder=Number(exact(bc))-Number(exact(ac));if(setOrder)return setOrder;
    const distance=cs=>requested.reduce((sum,c)=>sum+(c.fraction===null?0:Math.abs((cs.find(v=>v.name===c.name)?.fraction??0)-c.fraction)),0);
    const delta=distance(ac)-distance(bc);if(Math.abs(delta)>1e-6)return delta;
    const family=ac.map(c=>c.name).join('/').localeCompare(bc.map(c=>c.name).join('/'),'en');if(family)return family;
    const names=[...requested.map(c=>c.name),...ac.map(c=>c.name)].filter((n,i,all)=>all.indexOf(n)===i);
    for(const name of names){const delta=(ac.find(c=>c.name===name)?.fraction??0)-(bc.find(c=>c.name===name)?.fraction??0);if(Math.abs(delta)>1e-6)return delta;}
    return a.pressure_atm-b.pressure_atm || a.temperature_k-b.temperature_k || String(a.path||a.id||'').localeCompare(String(b.path||b.id||''),'en');
  }
  function compareTableFiles(a,b,q,key,direction=1) {
    if(!key)return compareFiles(a,b,q);
    let delta=0;
    if(key==='recipe') {
      // Ignore query relevance for an explicit recipe sort; percentages remain numeric.
      delta=compareFiles(a,b,{components:[]});
    }else {
      const field=key==='temperature'?'temperature_k':'pressure_atm';
      const av=a[field],bv=b[field];
      if(!Number.isFinite(av)||!Number.isFinite(bv)) {
        if(Number.isFinite(av)!==Number.isFinite(bv))return Number.isFinite(av)?-1:1;
      }else delta=av-bv;
    }
    return delta*direction || compareFiles(a,b,q);
  }
  const base = [
    ['veCmUs','沿 E 电子漂移速度','cm/μs',[0],'漂移速度','raw.ve'],
    ['vbCmUs','沿 B⊥ 漂移速度','cm/μs',[8],'漂移速度','raw.vb'],
    ['vexbCmUs','沿 E×B 漂移速度','cm/μs',[9],'漂移速度','raw.vexb'],
    ['dlUmSqrtCm','纵向扩散 Dₗ','μm/√cm',[2],'扩散','raw.dl / √p × 10⁴'],
    ['dtUmSqrtCm','横向扩散 Dₜ','μm/√cm',[7],'扩散','raw.dt / √p × 10⁴'],
    ['alpha','Townsend 系数 α','cm⁻¹',[3],'倍增与附着','p × exp(raw.alpha)'],
    ['alpha0','无 Penning Townsend α₀','cm⁻¹',[3],'倍增与附着','p × exp(raw.alpha0)'],
    ['eta','附着系数 η','cm⁻¹',[5],'倍增与附着','p × exp(raw.eta)'],
    ['alphaEff','有效 Townsend α−η','cm⁻¹',[3,5],'倍增与附着','alpha − eta'],
    ['alphaReduced','约化 Townsend α/p','cm⁻¹ Torr⁻¹',[3],'约化参数','exp(raw.alpha)'],
    ['etaReduced','约化吸附 η/p','cm⁻¹ Torr⁻¹',[5],'约化参数','exp(raw.eta)'],
    ['alphaOverN','α/N','cm²',[3],'约化参数','alpha / (N / 10⁶)'],
    ['etaOverN','η/N','cm²',[5],'约化参数','eta / (N / 10⁶)'],
    ['electronMobility','电子迁移率','cm²/(V·s)',[0],'其他参数','raw.ve × 10⁶ / E'],
    ['ionMobilityCm2Vs','离子迁移率','cm²/(V·s)',[1],'其他参数','raw.mu × 10⁶'],
    ['lorentz','Lorentz 角','°',[6],'其他参数','raw.lorentz × 180 / π（文件单位 rad）'],
    ['ionDissociation','离子解离系数','cm⁻¹',[11],'其他参数','p × exp(raw.dissociation)'],
    ['excitationTotal','总激发速率','ns⁻¹',[14],'碰撞速率','sum(raw.excitationRates)'],
    ['ionisationTotal','总电离速率','ns⁻¹',[15],'碰撞速率','sum(raw.ionisationRates)'],
  ];
  const rawBits={ve:0,vb:8,vexb:9,dl:2,dt:7,alpha:3,alpha0:3,eta:5,mu:1,lorentz:6,dissociation:11};
  const pathValue=(object,path)=>path.split('.').reduce((v,k)=>v == null ? undefined : v[k],object);
  const levelKey=l=>l.label.trim().replace(/\s+/g,' ')+'|'+l.energy;
  function parameters(gases) {
    const result = base.map(([key,label,unit,required,group,source])=>({key,label,unit,required,group,source,get:r=>key==='vbCmUs'?r.raw.vb:key==='vexbCmUs'?r.raw.vexb:key==='lorentz'?r.raw.lorentz*180/Math.PI:r[key]}));
    for(let i=0;i<6;i++) result.push({key:`tensor.${i}`,label:`扩散张量分量 ${i+1}`,unit:'原值 / Torr',required:[10],group:'扩散张量',source:`raw.tensor[${i}] / p`,get:r=>r.tensor[i]});
    for(const [name,bit] of Object.entries(rawBits)) for(const error of [false,true]) {
      const path=error?`raw.errors.${name}`:`raw.${name}`;
      if(error && name==='alpha0')continue;
      result.push({key:path,label:error?`${name} 原始误差字段`:`${name} 原始字段`,unit:'文件原值',required:[bit],group:error?'原始误差字段':'原始数值字段',source:path,get:r=>pathValue(r,path)});
    }
    for(let i=0;i<6;i++)result.push({key:`raw.errors.tensor.${i}`,label:`张量 ${i+1} 原始误差字段`,unit:'文件原值',required:[10],group:'原始误差字段',source:`raw.errors.tensor[${i}]`,get:r=>r.raw.errors?.tensor[i]});
    for(const [kind,collection,rates,bit] of [['exc','excitationLevels','excitationRates',14],['ion','ionisationLevels','ionisationRates',15]]) {
      const levels=new Map(); gases.forEach(g=>g[collection].forEach(l=>levels.set(levelKey(l),l)));
      for(const [id,level] of levels) for(const error of [false,true]) {
        result.push({key:`${kind}:${error?'err:':''}${id}`,label:(error?'误差 · ':'')+level.label,unit:error?'文件原值':'ns⁻¹',required:[bit],
          group:kind==='exc'?'激发通道':'电离通道',source:'按通道名称及能量匹配；'+(error?'保留原始误差语义':'不使用跨文件通道序号'),
          get:(r,g)=>{const i=g[collection].findIndex(l=>levelKey(l)===id);return i<0?undefined:(error?r.raw.errors?.[rates][i]:r.raw[rates][i]);}});
      }
    }
    const extra=Math.max(0,...gases.map(g=>g.extraValuesPerRecord));
    for(let i=0;i<extra;i++)result.push({key:`extension.${i}`,label:`未解释扩展值 ${i+1}`,unit:'文件原值',required:[],group:'未解释扩展值',source:'仅展示相同位置的原始数值，不代表跨文件物理含义一致',get:r=>r.extensionValues[i]});
    return result.filter(p=>!p.key.startsWith('raw.')&&!p.key.startsWith('extension.')&&!p.key.includes(':err:'));
  }
  function available(gas,param) {return param.required.every(bit=>gas.gasBits[bit]==='T') && gas.records.some(r=>Number.isFinite(param.get(r,gas)));}
  function slice(gas,b,angle) {
    const ib=gas.bRaw.findIndex(v=>near(v/100,b));
    const ia=b===0?0:gas.angles.findIndex(v=>near(v*180/Math.PI,angle));
    if(ib<0||ia<0)return [];
    return gas.records.filter(r=>r.ib===ib&&r.ia===ia);
  }
  function series(gas,param,b,angle,min,max) {
    if(!available(gas,param))return [];
    return slice(gas,b,angle).filter(r=>(r.E>=min||near(r.E,min))&&(r.E<=max||near(r.E,max)))
      .map(r=>({x:r.E,y:param.get(r,gas),record:r}));
  }
  return {bits,near,fmt,canonical,describe,parse,validateQuery,match,compareFiles,compareTableFiles,parameters,available,slice,series};
});
