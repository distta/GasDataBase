/* Browser-only catalogue UI. No uploads, accounts, runtime dependencies or eval. */
(() => {
  'use strict';
  const M = window.GasCatalogModel;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=M.fmt, colors=['#2455a4','#c83232','#278348','#8055a5','#d7851f','#39a0b5','#aa487b','#555555'];
  const state={catalog:null,collection:'',results:[],selected:new Set(),cache:new Map(),locals:new Map(),view:'catalog',params:[],plot:[],epoch:0,localCounter:0,preview:null,mode:'preview',group:'drift',sortKey:null,sortDirection:1};
  const number = id => $(id).value.trim()==='' ? null : $(id).valueAsNumber;
  const range = values => values.length > 1 ? `${fmt(values[0])}–${fmt(values[values.length-1])}` : values.length ? fmt(values[0]) : '—';
  const formula = name => esc(name).replace(/(\d+)/g,'<sub>$1</sub>');
  const shortLabel = file => file.components.length ? file.components.map(c=>c.name).join('/')+' '+file.components.map(c=>fmt(c.fraction)).join('/') : file.label;
  const title = file => file.components.length ? file.components.map(c=>`${formula(c.name)} <span>${fmt(c.fraction)}%</span>`).join(' <span class="muted">/</span> ') : esc(file.label);
  const thermoLabel=file=>`${fmt(file.temperature_k-273.15)} °C · ${fmt(file.pressure_atm)} atm`;
  const mixedThermo=files=>files.length>1&&files.some(f=>!M.near(f.temperature_k,files[0].temperature_k)||!M.near(f.pressure_atm,files[0].pressure_atm));
  const metaValue = value => value == null || value === '' ? '未记录' : value;
  const lookup = id => state.locals.get(id) || state.catalog?.files.find(f=>f.id===id);
  function notice(message) { $('noticeMessage').textContent=message; $('notice').hidden=!message; }
  function safeUrl(file) {
    if(!file.path?.startsWith('GasDataBase/') || /[\\?#]/.test(file.path) || file.path.split('/').includes('..')) throw Error('文件路径不合法。');
    const url=new URL(file.path.split('/').map(encodeURIComponent).join('/'), document.baseURI);
    if(url.origin!==location.origin || !['http:','https:'].includes(url.protocol)) throw Error('请通过本地 HTTP 服务打开目录。');
    return url;
  }
  async function digest(bytes) {
    if(!globalThis.crypto?.subtle)return null;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  async function load(id,background=false) {
    if(state.cache.has(id))return state.cache.get(id);
    const file=lookup(id);
    if(!file)throw Error('文件不在当前目录。');
    const promise=(async()=>{
      // A content-specific URL can safely reuse the browser's disk cache.
      const url=safeUrl(file);url.searchParams.set('sha256',file.sha256);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      let bytes;
      try {
        const response=await fetch(url,{cache:'force-cache',signal:controller.signal,priority:background?'low':'high'});
        if(!response.ok)throw Error(`下载失败：HTTP ${response.status}`);
        bytes=await response.arrayBuffer();
      }catch(error){
        if(error.name==='AbortError')throw Error('下载超时，请重新选择该气体重试。');
        throw error;
      }finally{clearTimeout(timer);}
      if(bytes.byteLength>50*1024*1024)throw Error('单文件超过 50 MiB，请缩小文件后重试。');
      const hash=await digest(bytes);
      if(hash && hash!==file.sha256)throw Error('文件已变化，目录索引尚未更新。请维护者运行 tools/catalog.py。');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const gas=M.parse(text,file.path.split('/').pop(),window.GarfieldGasParser);
      return {file,gas,bytes,hash,integrity:hash?'SHA-256 已核对':'当前浏览器未提供 SHA-256 校验'};
    })();
    state.cache.set(id,promise);
    try{return await promise;}catch(error){state.cache.delete(id);throw error;}
  }
  let prefetchStarted=false;
  function prefetchFiles() {
    if(prefetchStarted || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType||''))return;
    prefetchStarted=true;
    // Keep background traffic bounded as the database grows: at most 8 small
    // files, 1 MiB total and two concurrent requests, after the first plot.
    let budget=1024*1024;
    const queue=state.results.slice(0,8).map(item=>item.file).filter(file=>{
      if(state.cache.has(file.id)||!file.size_bytes||file.size_bytes>budget)return false;
      budget-=file.size_bytes;return true;
    });
    const worker=async()=>{while(queue.length){const file=queue.shift();try{await load(file.id,true);}catch{ /* Retry on explicit selection. */ }}};
    setTimeout(()=>{void worker();void worker();},300);
  }
  function download(name,data,type) {
    const url=URL.createObjectURL(new Blob([data],{type}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function rawDownload(id) {
    try {const entry=await load(id);download(entry.file.download_name || entry.gas.fileName,entry.bytes,'application/octet-stream');}
    catch(error){notice(error.message);}
  }
  let pickerCounter=0;
  function closePickers(except) {
    document.querySelectorAll('.select-picker.open').forEach(w=>{if(w!==except){w.classList.remove('open');w.querySelector('.picker-trigger').setAttribute('aria-expanded','false');}});
  }
  function enhanceSelects() {
    document.querySelectorAll('select').forEach(select=>{
      let wrapper=select.closest('.select-picker');
      if(!wrapper) {
        wrapper=document.createElement('span');wrapper.className='select-picker';
        select.before(wrapper);wrapper.append(select);select.classList.add('custom-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
        const button=document.createElement('button');button.type='button';button.className='picker-trigger';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
        const menu=document.createElement('span');menu.className='picker-menu';menu.id='picker-'+(++pickerCounter);menu.setAttribute('role','listbox');button.setAttribute('aria-controls',menu.id);wrapper.append(button,menu);
        const open=()=>{
          const wasOpen=wrapper.classList.contains('open');closePickers();if(wasOpen)return;
          menu.replaceChildren();
          const options=[...select.options];
          let filter;
          if(options.length>10){filter=document.createElement('input');filter.type='search';filter.placeholder='查找参数…';filter.setAttribute('aria-label','查找选项');menu.append(filter);}
          const list=document.createElement('span');list.className='picker-options';menu.append(list);
          const populate=()=>{list.replaceChildren();options.filter(o=>!filter||o.textContent.toLowerCase().includes(filter.value.toLowerCase())).forEach(option=>{
            const item=document.createElement('button');item.type='button';item.className='picker-option';item.innerHTML=select.closest('#componentRows')?formula(option.textContent):esc(option.textContent);item.disabled=option.disabled;item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));
            item.onclick=()=>{select.value=option.value;closePickers();enhanceSelects();select.dispatchEvent(new Event('change',{bubbles:true}));button.focus();};list.append(item);
          });};populate();if(filter)filter.oninput=populate;
          wrapper.classList.add('open');button.setAttribute('aria-expanded','true');
          const bounds=button.getBoundingClientRect(),below=innerHeight-bounds.bottom-12,above=bounds.top-12;
          wrapper.classList.toggle('opens-up',below<190&&above>below);menu.style.maxHeight=Math.max(100,Math.min(300,below<190&&above>below?above:below))+'px';
          if(filter)filter.focus();else list.querySelector('[aria-selected="true"]:not(:disabled)')?.focus();
        };
        button.onclick=open;
        button.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();}});
        menu.addEventListener('keydown',event=>{
          if(event.key==='Escape'){event.preventDefault();closePickers();button.focus();}
          if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const items=[...menu.querySelectorAll('.picker-option:not(:disabled)')],index=items.indexOf(document.activeElement);items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
        });
        select.addEventListener('change',enhanceSelects);
      }
      const trigger=wrapper.querySelector('.picker-trigger');trigger.innerHTML=select.closest('#componentRows')?formula(select.selectedOptions[0]?.textContent||'选择'):esc(select.selectedOptions[0]?.textContent||'选择');trigger.disabled=select.disabled;trigger.title=select.title;trigger.setAttribute('aria-label',select.getAttribute('aria-label')||'选择选项');
    });
  }
  function parameterCategory(p) {
    if(p.key.startsWith('raw.')||p.key.startsWith('extension.'))return 'more';
    if(p.group==='漂移速度')return 'drift';
    if(p.group==='扩散')return 'diffusion';
    if(p.key.startsWith('eta'))return 'attachment';
    if(p.key.startsWith('alpha'))return 'townsend';
    return 'more';
  }
  function renderParameters() {
    const prior=$('parameter').value,params=state.params.filter(p=>parameterCategory(p)===state.group);
    $('parameter').innerHTML=params.map(p=>{const available=entries.some(e=>M.available(e.gas,p));return `<option value="${esc(p.key)}" ${available?'':'disabled'}>${esc(p.label)} [${esc(p.unit)}]${available?'':' · 未提供'}</option>`;}).join('');
    const chosen=params.find(p=>p.key===prior&&entries.some(e=>M.available(e.gas,p)))||params.find(p=>entries.some(e=>M.available(e.gas,p)));
    if(chosen)$('parameter').value=chosen.key;
    document.querySelectorAll('[data-param-group]').forEach(tab=>{const active=tab.dataset.paramGroup===state.group;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
    enhanceSelects();
  }
  function addComponent(name='',fraction='') {
    const names=[...new Set((state.catalog?.files || []).flatMap(f=>f.components.map(c=>c.name)))].sort(M.componentOrder);
    const row=document.createElement('div');row.className='component-row';
    row.innerHTML=`<select aria-label="气体组分"><option value="">不限</option>${names.map(n=>`<option ${n===name?'selected':''} value="${esc(n)}">${esc(n)}</option>`).join('')}</select><div class="fraction-field"><input type="number" min="0" max="100" step="any" value="${esc(fraction)}" placeholder="不限" aria-label="组分比例"><span>%</span></div><button type="button" class="component-remove" aria-label="移除组分">×</button>`;
    row.querySelector('button').onclick=()=>{row.remove();if(!$('componentRows').children.length)addComponent();search();};
    row.querySelector('input[type=number]').addEventListener('input',event=>balanceRecipe(event.target));
    $('componentRows').append(row);enhanceSelects();
  }
  function query() {
    return {text:'',components:[...$('componentRows').children].map(row=>({name:row.querySelector('select').value,
      fraction:row.querySelector('input[type=number]').value===''?null:row.querySelector('input[type=number]').valueAsNumber})),temperature:number('temperature'),pressure:number('pressure'),
      b:null,angle:null,minE:null,maxE:null,fractionTolerance:1,fuzzyMatching:true,
      exactSet:true,partial:true};
  }
  function sortHeader(key,label) {
    const active=state.sortKey===key,direction=active?(state.sortDirection===1?'ascending':'descending'):'none';
    const next=active?(state.sortDirection===1?'降序':'恢复相关性排序'):'升序';
    return `<th scope="col" aria-sort="${direction}" class="sort-column sort-${key}"><button type="button" class="table-sort" data-sort="${key}" title="${next}" aria-label="${label}：${next}"><span>${label}</span><span class="sort-arrow" aria-hidden="true">${active?(state.sortDirection===1?'↑':'↓'):'↕'}</span></button></th>`;
  }
  function search() {
    if(!state.catalog)return;
    const scrollTop=$('results').scrollTop;
    const q=query(),error=M.validateQuery(q);
    $('queryError').textContent=error;$('queryError').hidden=!error;
    state.results=error?[]:state.catalog.files.map(file=>({file,match:M.match(file,q)})).filter(item=>item.match).sort((a,b)=>M.compareTableFiles(a.file,b.file,q,state.sortKey,state.sortDirection));
    const groups=new Map();
    state.results.forEach(item=>{const key=JSON.stringify(item.file.components.map(c=>[M.canonical(c.name),c.fraction]).sort());if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);});
    $('resultCount').textContent=`${groups.size} 种 / ${state.results.length} 份`;
    $('compareVisible').textContent=`比较当前 ${state.results.length} 项`;
    $('compareVisible').title='最多比较 8 份文件';
    $('resultSubtitle').textContent='点击预览 · 勾选比较';
    $('compareVisible').disabled=!state.results.length;
    $('emptyResults').hidden=!!state.results.length || !!error;
    const row=({file:f})=>`<tr class="file-row ${state.selected.has(f.id)?'selected':''} ${state.mode==='preview'&&state.preview===f.id?'previewing':''}" data-file="${f.id}">
      <td class="compare-cell"><label class="compare-target" title="加入或移出比较"><input type="checkbox" data-select="${f.id}" ${state.selected.has(f.id)?'checked':''} aria-label="比较 ${esc(f.label)}"></label></td>
      <td class="formula-cell"><div class="formula-line">${state.selected.has(f.id)||state.mode==='preview'&&state.preview===f.id?`<i class="swatch" style="background:${colors[Math.max(0,[...state.selected].indexOf(f.id))]}"></i>`:'<i class="swatch swatch-empty" aria-hidden="true"></i>'}<button class="recipe-name" data-preview="${f.id}" aria-label="预览 ${esc(f.label)}">${title(f)}</button>${state.mode==='preview'&&state.preview===f.id?'<span class="badge preview-badge">正在预览</span>':''}</div></td>
      <td class="file-facts" title="${fmt(f.temperature_k)} K">${fmt(f.temperature_k-273.15)}</td>
      <td title="${fmt(f.pressure_torr)} Torr">${fmt(f.pressure_atm)}</td>
      <td class="row-actions"><button class="text-button" data-detail="${f.id}">详情</button><button class="text-button" data-download="${f.id}" aria-label="下载 ${esc(f.label)}">下载</button></td></tr>`;
    $('results').innerHTML=state.results.length?`<table class="file-table" aria-label="气体文件检索结果"><thead><tr><th scope="col">比较</th>${sortHeader('recipe','气体配方')}${sortHeader('temperature','温度 (°C)')}${sortHeader('pressure','压强 (atm)')}<th scope="col">操作</th></tr></thead><tbody>${state.results.map(row).join('')}</tbody></table>`:'';
    $('results').scrollTop=scrollTop;
  }

  function resetSearch() {
    state.sortKey=null;state.sortDirection=1;
    $('searchForm').reset();$('componentRows').replaceChildren();
    addComponent();search();enhanceSelects();
  }
  function balanceRecipe(changed) {
    const rows=[...$('componentRows').children], named=rows.filter(r=>r.querySelector('select').value);
    if(named.length===2 && rows.length===2) {
      const other=named.map(r=>r.querySelector('input[type=number]')).find(i=>i!==changed);
      if(changed.value==='')other.value='';
      else if(Number.isFinite(changed.valueAsNumber)&&changed.valueAsNumber>=0&&changed.valueAsNumber<=100)other.value=Number((100-changed.valueAsNumber).toFixed(6));
    }
    
  }
  function counts() {
    const ids=[...state.selected],showThermo=mixedThermo([...state.selected].map(lookup));
    $('clearSelected').disabled=!ids.length;$('selectionCount').textContent=`已选 ${ids.length} 项`;
    $('returnComparison').hidden=state.mode==='compare'||!ids.length;
    $('selectedFiles').innerHTML=ids.map((id,i)=>{const f=lookup(id),label=f.label+(showThermo?' · '+thermoLabel(f):'');return `<div class="selected-chip"><i class="swatch" style="background:${colors[i]}"></i><button class="text-button" data-preview="${id}">${esc(label)}</button>${f.local?'<span class="badge">本地</span>':''}<button data-remove="${id}" title="移出比较" aria-label="移除 ${esc(label)}">×</button></div>`;}).join('')||'<span class="hint">尚未选择文件</span>';
  }
  function select(id,on) {
    if(on && state.selected.size>=8 && !state.selected.has(id)){notice('每次最多比较 8 份文件，请先移除不需要的文件。');search();return;}
    if(on)state.selected.add(id);else state.selected.delete(id);
    state.mode=state.selected.size?'compare':'preview';
    counts();search();renderComparison();
  }
  function preview(id) {state.preview=id;state.mode='preview';counts();search();renderComparison();}
  function view(name) {
    state.view=name==='maintain'?'maintain':'catalog';
    document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${state.view}`);
    document.querySelectorAll('.nav-link').forEach(el=>{el.classList.toggle('active',el.dataset.view===state.view);if(el.dataset.view===state.view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    if(location.hash!==`#${state.view}`)history.replaceState(null,'',`#${state.view}`);
    counts();
  }
  function fillSelect(id,values,label) {
    const prior=$(id).value;$(id).innerHTML=values.map(v=>`<option value="${esc(v)}">${esc(label(v))}</option>`).join('');
    if(values.some(v=>String(v)===prior))$(id).value=prior;
    enhanceSelects();
  }
  let entries=[];
  async function renderComparison() {
    const epoch=++state.epoch;
    const ids=state.mode==='compare'?[...state.selected]:(state.preview?[state.preview]:[]);
    $('compareEmpty').hidden=!!ids.length;$('compareWorkspace').hidden=!ids.length;
    ['exportCsv','exportSvg','exportRaw'].forEach(id=>$(id).disabled=true);state.plot=[];
    if(!ids.length){entries=[];state.plot=[];$('chart').replaceChildren();$('plotContext').textContent='选择文件即可预览';return;}
    $('plotNotice').textContent='正在读取选中的气体表…';
    const results=await Promise.all(ids.map(async id=>{try{return await load(id);}catch(error){return {error:`${lookup(id)?.label || '文件'}：${error.message}`,id};}}));
    if(epoch!==state.epoch)return;
    const failures=results.filter(e=>e.error);failures.forEach(e=>state.selected.delete(e.id));
    if(failures.length)notice(failures.map(e=>e.error).join('\n'));
    entries=results.filter(e=>!e.error);counts();search();
    $('compareEmpty').hidden=!!entries.length;$('compareWorkspace').hidden=!entries.length;
    $('plotContext').textContent=entries.length?(state.mode==='compare'?`${entries.length} 份文件 · 叠加显示原始计算点`:entries[0].file.label):'文件读取失败，请重新选择';
    if(!entries.length){return;}
    state.params=M.parameters(entries.map(e=>e.gas));renderParameters();
    const sameThermo=entries.every(e=>M.near(e.gas.pressure,entries[0].gas.pressure)&&M.near(e.gas.temperature,entries[0].gas.temperature));
    $('plotThermo').textContent=sameThermo?fmt(entries[0].gas.temperature-273.15)+' °C · '+fmt(entries[0].gas.pressure/760)+' atm':'多种温压 · 见图例';
    $('plotThermo').title=entries.map(e=>`${e.file.label}: ${fmt(e.gas.temperature)} K · ${fmt(e.gas.pressure)} Torr`).join('\n');
    fillSelect('plotB',[...new Set(entries.flatMap(e=>e.file.magnetic_fields))].sort((a,b)=>a-b),v=>`${fmt(v)} T`);
    updateAngles();setRange(false);prefetchFiles();
  }
  function updateAngles() {
    const b=Number($('plotB').value);
    if(b===0){fillSelect('plotAngle',[90],()=> '90°');$('plotAngle').disabled=true;$('plotAngle').title='B=0 时方向无物理区分；90°为界面约定，原始夹角保留在详情和导出中。';enhanceSelects();return;}
    $('plotAngle').disabled=false;$('plotAngle').title='';
    fillSelect('plotAngle',[...new Set(entries.filter(e=>e.file.magnetic_fields.some(v=>M.near(v,b))).flatMap(e=>e.file.angles_deg))].sort((a,b)=>a-b),v=>`${fmt(v)}°`);
  }
  let electricRange=[null,null];
  function setRange(common) {
    const slices=entries.map(e=>M.slice(e.gas,Number($('plotB').value),Number($('plotAngle').value))).filter(s=>s.length);
    if(slices.length){
      const min=(common?Math.max:Math.min)(...slices.map(s=>s[0].E)),max=(common?Math.min:Math.max)(...slices.map(s=>s[s.length-1].E));
      electricRange=[min,max];
    }
    draw();
  }
  function svgNode(tag,attrs={},text) {
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));if(text!==undefined)node.textContent=text;return node;
  }
  function draw() {
    const svg=$('chart');cancelZoom();state.chartView=null;svg.replaceChildren();state.plot=[];$('chartTooltip').hidden=true;
    $('chartLegend').replaceChildren();$('parameterSource').textContent='';
    ['exportCsv','exportSvg','exportRaw'].forEach(id=>$(id).disabled=true);
    const p=state.params.find(p=>p.key===$('parameter').value),min=electricRange[0],max=electricRange[1];
    if(!p||min===null||max===null||!Number.isFinite(min+max)||min<0||min>=max){$('plotNotice').textContent='请输入有效的电场范围，起点应小于终点。';$('plotData').replaceChildren();return;}
    const logX=$('logX').checked,logY=$('logY').checked,b=Number($('plotB').value),angle=Number($('plotAngle').value);
    if(logX&&min<=0){$('plotNotice').textContent='对数横轴要求电场起点大于 0。';$('plotData').replaceChildren();return;}
    const axis=$('plotXAxis').value,unit={E:'kV/cm',EoverP:'V/(cm·Torr)',EoverN:'Td'}[axis],axisLabel={E:'E',EoverP:'E/p',EoverN:'E/N'}[axis];
    $('axisXUnit').textContent=unit;$('axisYUnit').textContent=p.unit;
    const showThermo=mixedThermo(entries.map(e=>e.file));
    const warnings=[];let skipped=0;
    entries.forEach((e,i)=>{
      if(!M.available(e.gas,p)){warnings.push(e.file.label+' 未提供该参数');return;}
      if(!M.slice(e.gas,b,angle).length){warnings.push(e.file.label+' 未计算此磁场 / 夹角');return;}
      const points=M.series(e.gas,p,b,angle,min,max).map(pt=>{
        const x=pt.record[axis]*(axis==='E'?.001:1),valid=Number.isFinite(x)&&Number.isFinite(pt.y)&&(!logX||x>0)&&(!logY||pt.y>0);
        if(!valid)skipped++;return {...pt,x,valid};
      });
      if(!points.some(pt=>pt.valid)){warnings.push(e.file.label+' 在此范围内没有有效点');return;}
      const index=[...state.selected].indexOf(e.file.id),factor=axis==='E'?.001:axis==='EoverP'?1/e.gas.pressure:100/e.gas.numberDensity/1e-21;
      state.plot.push({entry:e,color:colors[index<0?i:index],points,xmin:min*factor,xmax:max*factor});
    });
    if(skipped)warnings.push(skipped+' 个不适用于当前坐标的数值未绘制');
    $('plotNotice').textContent=warnings.join('；');
    $('parameterSource').textContent=p.unit+' · 来源：'+p.source+(p.key.startsWith('alpha')?'。此处展示倍增系数，非气体增益。':'')+(b===0?'。B=0 时显示 90°约定角；计算记录保留原始夹角。':'');
    if(!state.plot.length){svg.append(svgNode('text',{x:360,y:220,'text-anchor':'middle',fill:'#8793a5','font-size':16},'当前条件没有可绘制的数据'));$('plotData').replaceChildren();return;}
    const ys=state.plot.flatMap(s=>s.points.filter(pt=>pt.valid).map(pt=>pt.y));
    let ymin=Math.min(...ys),ymax=Math.max(...ys);
    if(logY){if(ymin===ymax){ymin/=2;ymax*=2;}else{const d=(Math.log10(ymax)-Math.log10(ymin))*.08;ymin=10**(Math.log10(ymin)-d);ymax=10**(Math.log10(ymax)+d);}}
    else {const pad=(ymax-ymin||Math.abs(ymax)||1)*.08;ymin=ymin>=0?0:ymin-pad;ymax+=pad;}
    const niceStep=(a,z)=>{const raw=(z-a)/6,power=10**Math.floor(Math.log10(raw));return [1,2,2.5,5,10].find(n=>n*power>=raw)*power;};
    let ystep;
    if(!logY){ystep=niceStep(ymin,ymax);ymin=Math.floor(ymin/ystep)*ystep;ymax=Math.ceil(ymax/ystep)*ystep;}
    let xmin=Math.min(...state.plot.map(s=>s.xmin)),xmax=Math.max(...state.plot.map(s=>s.xmax));
    if(!logX){const step=niceStep(xmin,xmax);xmin=Math.floor(xmin/step)*step;}
    const requested=['axisXMin','axisXMax','axisYMin','axisYMax'].map(number);
    [xmin,xmax,ymin,ymax]=[xmin,xmax,ymin,ymax].map((v,i)=>requested[i]??v);
    if(![xmin,xmax,ymin,ymax].every(Number.isFinite)||xmin>=xmax||ymin>=ymax||(logX&&xmin<=0)||(logY&&ymin<=0)){
      $('plotNotice').textContent='坐标下限须小于上限；对数坐标的上下限必须大于 0。';$('plotData').replaceChildren();state.plot=[];return;
    }
    const tickText=v=>Math.abs(v)>=1e5||(Math.abs(v)>0&&Math.abs(v)<.001)?v.toExponential(4):fmt(Number(v.toPrecision(5)));
    const left=Math.max(110,Math.max(tickText(ymin).length,tickText(ymax).length)*11+56);
    const area={x:left,y:22,w:700-left,h:450},height=545;
    state.plot.forEach(s=>s.points.forEach(pt=>{pt.visible=pt.valid&&(pt.x>=xmin||M.near(pt.x,xmin))&&(pt.x<=xmax||M.near(pt.x,xmax))&&(pt.y>=ymin||M.near(pt.y,ymin))&&(pt.y<=ymax||M.near(pt.y,ymax));}));

    svg.setAttribute('viewBox','0 0 900 '+height);
    svg.setAttribute('font-family','Microsoft YaHei, 微软雅黑, sans-serif');
    svg.setAttribute('style','font-family:Microsoft YaHei,微软雅黑,sans-serif');
    const scale=(v,a,z,log)=>((log?Math.log10(v):v)-(log?Math.log10(a):a))/((log?Math.log10(z):z)-(log?Math.log10(a):a));
    const x=v=>area.x+area.w*scale(v,xmin,xmax,logX),y=v=>area.y+area.h*(1-scale(v,ymin,ymax,logY));
    state.chartView={area,xmin,xmax,ymin,ymax,logX,logY};
    svg.append(svgNode('rect',{width:900,height,fill:'#fff'}));
    const within=(v,a,z)=>v>=a*(1-1e-8)&&v<=z*(1+1e-8);
    const ticks=(a,z,log)=>{
      const major=[],minor=[];
      if(log){for(let k=Math.floor(Math.log10(a));k<=Math.ceil(Math.log10(z));k++)for(let m=1;m<=9;m++){const v=m*10**k;if(within(v,a,z))(m===1||m===3?major:minor).push(v);}if(major.length<2){major.push(a,z);}}
      else {const step=niceStep(a,z);for(let v=Math.ceil(a/step)*step;v<=z+step*1e-7;v+=step)major.push(v);
        for(let n=Math.ceil(a/(step/5));n<=Math.floor(z/(step/5));n++)if(n%5!==0)minor.push(n*step/5);}
      return {major:[...new Set(major)].sort((a,b)=>a-b),minor};
    };
    const xt=ticks(xmin,xmax,logX),yTicks=ticks(ymin,ymax,logY),yt=yTicks.major,yminor=yTicks.minor;
    // Light major grid behind the curves and ROOT-style inward ticks.
    xt.major.forEach(v=>svg.append(svgNode('line',{x1:x(v),x2:x(v),y1:area.y,y2:area.y+area.h,stroke:'#d9d9d9','stroke-width':0.8,'data-grid':'x'})));
    yt.forEach(v=>svg.append(svgNode('line',{x1:area.x,x2:area.x+area.w,y1:y(v),y2:y(v),stroke:'#d9d9d9','stroke-width':0.8,'data-grid':'y'})));
    const xTick=(v,length)=>{
      [area.y,area.y+area.h].forEach((edge,i)=>svg.append(svgNode('line',{x1:x(v),x2:x(v),y1:edge,y2:edge+(i?-length:length),stroke:'#111','stroke-width':1.2,'data-axis-tick':'x'})));
    };
    const yTick=(v,length)=>{
      [area.x,area.x+area.w].forEach((edge,i)=>svg.append(svgNode('line',{x1:edge,x2:edge+(i?-length:length),y1:y(v),y2:y(v),stroke:'#111','stroke-width':1.2,'data-axis-tick':'y'})));
    };
    xt.minor.forEach(v=>xTick(v,5));
    xt.major.forEach(v=>{
      xTick(v,10);
      svg.append(svgNode('text',{x:x(v),y:area.y+area.h+27,'text-anchor':'middle',fill:'#111','font-size':18},Number(v.toPrecision(12)).toLocaleString('en-US',{useGrouping:false,maximumSignificantDigits:12})));
    });
    yminor.forEach(v=>yTick(v,5));
    yt.forEach(v=>{
      yTick(v,10);
      svg.append(svgNode('text',{x:area.x-12,y:y(v)+6,'text-anchor':'end',fill:'#111','font-size':18},tickText(v)));
    });
    svg.append(svgNode('rect',{x:area.x,y:area.y,width:area.w,height:area.h,fill:'none',stroke:'#111','stroke-width':1.4,'data-axis-frame':'true'}));
    svg.append(svgNode('text',{x:area.x+area.w,y:529,'text-anchor':'end',fill:'#111','font-size':20},axisLabel+' ('+unit+')'));
    const ylabel=p.key==='veCmUs'?'v ('+p.unit+')':p.label+' ('+p.unit+')';
    const yTitle=svgNode('text',{transform:'translate(25 '+(area.y+area.h/2)+') rotate(-90)','text-anchor':'middle',fill:'#111','font-size':20},ylabel);svg.append(yTitle);
    if(yTitle.getComputedTextLength()>area.h){yTitle.setAttribute('textLength',area.h);yTitle.setAttribute('lengthAdjust','spacingAndGlyphs');}
    const defs=svgNode('defs'),clip=svgNode('clipPath',{id:'plotClip'});clip.append(svgNode('rect',{x:area.x,y:area.y,width:area.w,height:area.h}));defs.append(clip);svg.append(defs);
    const curves=svgNode('g',{'clip-path':'url(#plotClip)'});svg.append(curves);
    state.plot.forEach(s=>{
      let d='',continuing=false;s.points.forEach(pt=>{if(!pt.valid){continuing=false;return;}d+=(continuing?'L':'M')+x(pt.x).toFixed(3)+','+y(pt.y).toFixed(3)+' ';continuing=true;});
      curves.append(svgNode('path',{d,fill:'none',stroke:s.color,'stroke-width':2,'stroke-linejoin':'round','data-series':s.entry.file.id}));
      s.points.filter(pt=>pt.visible).forEach(pt=>{
        const circle=svgNode('circle',{cx:x(pt.x),cy:y(pt.y),r:$('showPoints').checked?3:5,fill:$('showPoints').checked?s.color:'transparent','data-point':'true'});
        const hoverNumber=value=>{
          if(!Number.isFinite(value))return '—';
          if(value===0)return '0';
          const rounded=Number(value.toPrecision(5));
          return Math.abs(rounded)>=1e6||Math.abs(rounded)<.0001?rounded.toExponential().replace('e+','e'):String(rounded);
        };
        const message=shortLabel(s.entry.file)+(showThermo?'\n'+thermoLabel(s.entry.file):'')+'\n'+axisLabel+' = '+hoverNumber(pt.x)+' '+unit+(axis==='E'?' ('+hoverNumber(pt.record.E)+' V/cm)':'')+'\n'+p.label+' = '+hoverNumber(pt.y)+' '+p.unit;
        circle.setAttribute('aria-label',message);
        circle.addEventListener('pointerenter',event=>{
          if(zoomDrag)return;
          const bounds=svg.parentElement.getBoundingClientRect(),tooltip=$('chartTooltip');
          tooltip.innerHTML=`<div class="tooltip-heading"><i class="swatch" style="background:${s.color}"></i><strong>${esc(shortLabel(s.entry.file))}</strong></div>${showThermo?`<div class="tooltip-thermo">${esc(thermoLabel(s.entry.file))}</div>`:''}<dl><dt>${esc(axisLabel)}</dt><dd>${esc(hoverNumber(pt.x))} <small>${esc(unit)}</small></dd><dt>${esc(p.label)}</dt><dd>${esc(hoverNumber(pt.y))} <small>${esc(p.unit)}</small></dd></dl>`;
          tooltip.hidden=false;
          const box=tooltip.getBoundingClientRect();
          tooltip.style.left=Math.max(0,Math.min(event.clientX-bounds.left+12,bounds.width-box.width))+'px';
          tooltip.style.top=Math.max(0,Math.min(event.clientY-bounds.top-box.height-12,bounds.height-box.height))+'px';
        });
        circle.addEventListener('pointerleave',()=>$('chartTooltip').hidden=true);curves.append(circle);
      });
    });
    state.plot.forEach((s,i)=>{
      const lx=area.x+area.w+16,ly=area.y+18+i*(showThermo?52:36);
      svg.append(svgNode('line',{x1:lx,x2:lx+22,y1:ly,y2:ly,stroke:s.color,'stroke-width':2}));
      svg.append(svgNode('circle',{cx:lx+11,cy:ly,r:3,fill:s.color,'data-legend':'true'}));
      const label=shortLabel(s.entry.file),node=svgNode('text',{x:lx+29,y:ly+5,fill:'#111','font-size':16},label.length>23?label.slice(0,22)+'…':label);node.append(svgNode('title',{},label+(showThermo?' · '+thermoLabel(s.entry.file):'')));svg.append(node);
      const legendTextWidth=150;
      if(node.getComputedTextLength()>legendTextWidth){node.setAttribute('textLength',legendTextWidth);node.setAttribute('lengthAdjust','spacingAndGlyphs');}
      if(showThermo){const condition=svgNode('text',{x:lx+29,y:ly+23,fill:'#526675','font-size':13,'data-legend-thermo':'true'},thermoLabel(s.entry.file));svg.append(condition);if(condition.getComputedTextLength()>legendTextWidth){condition.setAttribute('textLength',legendTextWidth);condition.setAttribute('lengthAdjust','spacingAndGlyphs');}}
    });
    const rows=state.plot.flatMap(s=>s.points.filter(pt=>pt.visible).map(pt=>[s.entry.file.label,fmt(pt.record.E),fmt(pt.x),fmt(pt.y),fmt(pt.record.BTesla),fmt(pt.record.angleDeg)]));
    $('plotData').innerHTML=htmlTable(['配方','E [V/cm]',axisLabel+' ['+unit+']',p.label+' ['+p.unit+']','B [T]','原始夹角 [°]'],rows);
    ['exportCsv','exportSvg','exportRaw'].forEach(id=>$(id).disabled=false);
  }
  function htmlTable(headers,rows){return `<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
  function csv() {
    const p=state.params.find(p=>p.key===$('parameter').value);if(!p||!state.plot.length)return;
    const rows=[['file','source_path','sha256','temperature_K','pressure_Torr','parameter','unit','E_V_cm','E_over_p_V_cm_Torr','E_over_N_Td','B_T','angle_deg','value','interpolated','x_parameter','x_unit','x_value']];
    state.plot.forEach(s=>s.points.filter(pt=>pt.visible).forEach(pt=>rows.push([s.entry.gas.fileName,s.entry.file.path||'',s.entry.hash||'',s.entry.gas.temperature,s.entry.gas.pressure,p.key,p.unit,pt.record.E,pt.record.EoverP,pt.record.EoverN,pt.record.BTesla,pt.record.angleDeg,pt.y,false,$('plotXAxis').value,{E:'kV/cm',EoverP:'V/(cm·Torr)',EoverN:'Td'}[$('plotXAxis').value],pt.x])));
    const quote=value=>{let s=String(value??'');if(typeof value==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    download('gas-comparison.csv','\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  }
  function flatten(object,prefix='',out=[]) {
    Object.entries(object).forEach(([k,v])=>{const key=prefix?prefix+'.'+k:k;if(v && typeof v==='object')flatten(v,key,out);else out.push([key,v==null?'未提供':v]);});return out;
  }
  let detailEpoch=0;
  async function detail(id) {
    const epoch=++detailEpoch,file=lookup(id);if(!file)return;
    $('detailTitle').textContent=file.label;$('detailContent').textContent='正在读取完整文件…';
    if(!$('detailDialog').open)$('detailDialog').showModal();
    try {
      const entry=await load(id);if(epoch!==detailEpoch)return;
      const g=entry.gas, f=entry.file, d=f.dimensions;
      const reference=f.reference_check;
      $('detailContent').innerHTML=`<div class="detail-actions"><button class="button primary" data-add-detail="${f.id}">${state.selected.has(f.id)?'已加入比较':'加入比较'}</button><button class="button secondary" data-download="${f.id}">下载原始 .gas</button></div>
        <section class="detail-section"><h3>基本信息</h3>
        ${htmlTable(['项目','数值'],[['气体配方',f.label],['温度',`${fmt(g.temperature-273.15)} °C（${fmt(g.temperature)} K）`],['压强',`${fmt(g.pressure/760)} atm（${fmt(g.pressure)} Torr）`],['记录数量',`${fmt(g.records.length)} 条`],['文件校验',entry.integrity]])}</section>
        <section class="detail-section"><h3>计算网格</h3>
        ${htmlTable(['变量','覆盖范围','采样点数'],[['电场 E (kV/cm)',range(f.electric_fields.map(v=>v/1000)),d.electric],['磁场 B (T)',range(f.magnetic_fields),d.magnetic],['E–B 夹角 (°)',range(f.angles_deg),d.angle]])}
        <details><summary>查看全部采样点</summary><dl class="grid-values"><dt>电场 E (kV/cm)</dt><dd>${f.electric_fields.map(v=>fmt(v/1000)).join(' · ')}</dd><dt>磁场 B (T)</dt><dd>${f.magnetic_fields.map(fmt).join(' · ')}</dd><dt>文件记录夹角 (°)</dt><dd>${f.angles_deg.map(fmt).join(' · ')}</dd></dl></details>
        ${reference?`<details><summary>与目标计算规范对照</summary><p class="hint">尚缺 ${reference.missing_electric_points.length} 个目标电场点；${reference.missing_magnetic_points.length?'缺少磁场点 '+reference.missing_magnetic_points.join(' / ')+' T':'磁场已覆盖'}；${reference.angle_matches?'记录夹角匹配':'记录夹角不同（B=0 时无方向区分）'}。原文件未重采样。</p></details>`:''}</section>
        <section class="detail-section"><h3>来源与版本</h3>${htmlTable(['项目','记录'],[['来源',f.local?'用户本地文件':metaValue(f.metadata.source)],['贡献者',metaValue(f.metadata.contributor)],['Garfield++ 版本',metaValue(f.metadata.garfield_version)],['Magboltz 版本',metaValue(f.metadata.magboltz_version)],['文件格式版本',g.version],['备注',metaValue(f.metadata.notes)]])}
        <details><summary>文件标识与完整性</summary>${htmlTable(['项目','记录'],[['原始标识',g.identifier],['原路径',f.path||g.fileName],['下载名称',f.download_name||g.fileName],['SHA-256',entry.hash||'当前环境未计算'],['每条记录的扩展值数量',g.extraValuesPerRecord]])}</details></section>
        <section class="detail-section"><h3>参数与原始数据</h3>
        <details><summary>参数可用性（GASOK）</summary>${htmlTable(['参数','文件声明'],M.bits.map((label,i)=>[label,g.gasBits[i]==='T'?'可用':'未提供']))}<p class="hint">原始表里的占位零不会被当作有效物理参数绘制。</p></details>
        <details><summary>逐条记录与原始误差</summary><label class="record-picker">记录 <input id="recordIndex" type="number" min="1" max="${g.records.length}" value="1"> / ${g.records.length}</label><div id="recordData" class="table-scroll"></div><p class="hint">误差保留文件原值，不推断百分比或标准差定义。</p></details>
        <details><summary>激发通道信息 · ${g.nExc}</summary><div class="table-scroll">${htmlTable(['编号','名称','能量 [eV]','Penning 概率','Penning RMS 原值','衰减时间原值'],g.excitationLevels.map(l=>[l.index,l.label,l.energy,l.penningProbability,l.penningRms,l.decayTime]))}</div></details>
        <details><summary>电离通道信息 · ${g.nIon}</summary><div class="table-scroll">${htmlTable(['编号','名称','能量 [eV]'],g.ionisationLevels.map(l=>[l.index,l.label,l.energy]))}</div></details>
        <details><summary>文件表头与页脚</summary><pre>${esc(g.header+'\n'+g.footer)}</pre></details>
        <details><summary>完整原始文件</summary><pre>${esc(g.rawText)}</pre></details></section>`;
      const record=()=>{const i=$('recordIndex').valueAsNumber-1;if(!Number.isInteger(i)||i<0||i>=g.records.length){$('recordData').textContent='请输入有效记录编号。';return;}$('recordData').innerHTML=htmlTable(['字段','数值'],flatten(g.records[i]));};
      $('recordIndex').oninput=record;record();
    }catch(error){if(epoch===detailEpoch)$('detailContent').textContent='读取失败：'+error.message;}
  }
  async function importFiles(files) {
    const errors=[],items=[...files];let added=0,duplicate=0;
    if(items.reduce((sum,f)=>sum+f.size,0)>200*1024*1024){notice('本次文件总量超过 200 MiB，请分批添加。');return;}
    for(const file of items) {
      try {
        if(state.selected.size>=8)throw Error('比较列表已满（最多 8 份）');
        if(file.size>50*1024*1024)throw Error('单文件超过 50 MiB');
        const bytes=await file.arrayBuffer(),hash=await digest(bytes),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        const gas=M.parse(text,file.name,window.GarfieldGasParser);
        let id=hash;
        if(!id){const loaded=await Promise.all([...state.cache.values()].map(p=>Promise.resolve(p).catch(()=>null)));id=loaded.find(e=>e?.gas.rawText===text)?.file.id || `local-${++state.localCounter}`;}
        if(state.selected.has(id)){duplicate++;continue;}
        let descriptor=lookup(id);
        if(!descriptor){descriptor={...M.describe(gas,file.name),id,sha256:hash,path:'',local:true,size_bytes:file.size,download_name:file.name};state.locals.set(id,descriptor);}
        state.cache.set(id,Promise.resolve({file:descriptor,gas,bytes,hash,integrity:hash?'已计算 SHA-256':'当前浏览器未提供 SHA-256 校验'}));state.selected.add(id);added++;
      }catch(error){errors.push(`${file.name}：${error.message}`);}
    }
    $('localFiles').value='';
    notice([`添加 ${added} 份本地文件${duplicate?`，跳过 ${duplicate} 份重复文件`:''}。文件未上传。`,...errors].join('\n'));
    state.mode=state.selected.size?'compare':'preview';search();view('catalog');renderComparison();
  }
  let zoomDrag=null;
  function cancelZoom(){if(zoomDrag){zoomDrag.rect.remove();zoomDrag=null;}}
  function setAxisBounds(bounds){
    if(!bounds.every(Number.isFinite))return;
    ['axisXMin','axisXMax','axisYMin','axisYMax'].forEach((id,i)=>$(id).value=Number(bounds[i].toPrecision(10)));
    draw();
  }
  function bindZoom(){
    const svg=$('chart');
    const position=event=>{
      const matrix=svg.getScreenCTM();if(!matrix)return null;
      return new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    };
    const inside=(p,a)=>p&&p.x>=a.x&&p.x<=a.x+a.w&&p.y>=a.y&&p.y<=a.y+a.h;
    const unscale=(t,lo,hi,log)=>log?10**(Math.log10(lo)+t*(Math.log10(hi)-Math.log10(lo))):lo+t*(hi-lo);
    svg.addEventListener('pointerdown',event=>{
      const view=state.chartView,p=position(event);
      if(event.button!==0||event.pointerType==='touch'||!view||!inside(p,view.area))return;
      cancelZoom();event.preventDefault();$('chartTooltip').hidden=true;
      const rect=svgNode('rect',{x:p.x,y:p.y,width:0,height:0,fill:'#16858c','fill-opacity':.12,stroke:'#16858c','stroke-width':1,'stroke-dasharray':'4 3','pointer-events':'none','data-zoom-box':'true'});
      svg.append(rect);zoomDrag={start:p,clientX:event.clientX,clientY:event.clientY,pointer:event.pointerId,view,rect};
    });
    window.addEventListener('pointermove',event=>{
      if(!zoomDrag||event.pointerId!==zoomDrag.pointer)return;
      const p=position(event);if(!p)return;
      const {area}=zoomDrag.view,start=zoomDrag.start;
      const end={x:Math.max(area.x,Math.min(p.x,area.x+area.w)),y:Math.max(area.y,Math.min(p.y,area.y+area.h))};
      zoomDrag.end=end;const r=zoomDrag.rect;
      r.setAttribute('x',Math.min(start.x,end.x));r.setAttribute('y',Math.min(start.y,end.y));r.setAttribute('width',Math.abs(end.x-start.x));r.setAttribute('height',Math.abs(end.y-start.y));
    });
    window.addEventListener('pointerup',event=>{
      if(!zoomDrag||event.pointerId!==zoomDrag.pointer)return;
      const drag=zoomDrag;cancelZoom();
      if(!drag.end||Math.abs(event.clientX-drag.clientX)<6||Math.abs(event.clientY-drag.clientY)<6||drag.view!==state.chartView)return;
      const {area,xmin,xmax,ymin,ymax,logX,logY}=drag.view,{start,end}=drag;
      const xx=v=>unscale((v-area.x)/area.w,xmin,xmax,logX),yy=v=>unscale(1-(v-area.y)/area.h,ymin,ymax,logY);
      setAxisBounds([xx(Math.min(start.x,end.x)),xx(Math.max(start.x,end.x)),yy(Math.max(start.y,end.y)),yy(Math.min(start.y,end.y))]);
    });
    window.addEventListener('pointercancel',cancelZoom);window.addEventListener('blur',cancelZoom);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')cancelZoom();});
    svg.addEventListener('dblclick',event=>{if(state.chartView&&inside(position(event),state.chartView.area)){event.preventDefault();cancelZoom();$('autoAxes').click();}});

  }
  function bind() {
    bindZoom();
    document.addEventListener('click',event=>{if(!event.target.closest('.select-picker'))closePickers();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closePickers();});
    window.addEventListener('resize',()=>closePickers());
    const narrow=window.matchMedia('(max-width: 700px)');
    const drawer=$('filterDrawer');drawer.open=!narrow.matches;
    const drawerHint=()=>{drawer.querySelector('.mobile-filter-hint').textContent=drawer.open?'收起 ▴':'展开 ▾';};
    drawer.addEventListener('toggle',drawerHint);drawerHint();
    document.addEventListener('click',event=>{
      const el=event.target.closest('button');if(!el)return;
      if(el.dataset.view)view(el.dataset.view);
      if(el.dataset.paramGroup){state.group=el.dataset.paramGroup;renderParameters();$('axisYMin').value='';$('axisYMax').value='';draw();}
      if(el.dataset.detail)detail(el.dataset.detail);
      if(el.dataset.preview)preview(el.dataset.preview);
      if(el.dataset.download)rawDownload(el.dataset.download);
      if(el.dataset.remove)select(el.dataset.remove,false);
      if(el.dataset.addDetail){select(el.dataset.addDetail,true);el.textContent=state.selected.has(el.dataset.addDetail)?'已加入比较':'加入比较';}
      if(el.classList.contains('local-trigger'))$('localFiles').click();
    });
    $('results').addEventListener('click',event=>{
      const sort=event.target.closest('[data-sort]');
      if(sort){
        const key=sort.dataset.sort;
        if(state.sortKey!==key){state.sortKey=key;state.sortDirection=1;}
        else if(state.sortDirection===1)state.sortDirection=-1;
        else{state.sortKey=null;state.sortDirection=1;}
        search();$('results').querySelector(`[data-sort="${key}"]`).focus();return;
      }
      const card=event.target.closest('.file-row');
      if(card&&!event.target.closest('button, input, label, a, select, summary'))preview(card.dataset.file);
    });
    $('results').addEventListener('change',event=>{if(event.target.dataset.select)select(event.target.dataset.select,event.target.checked);});
    $('searchForm').onsubmit=e=>{e.preventDefault();search();};
    $('searchForm').addEventListener('input',search);$('searchForm').addEventListener('change',()=>{search();enhanceSelects();});
    $('addComponent').onclick=()=>{addComponent();search();};$('resetSearch').onclick=resetSearch;$('emptyReset').onclick=resetSearch;
    $('compareVisible').onclick=()=>{for(const {file} of state.results){if(state.selected.size>=8)break;state.selected.add(file.id);}if(state.results.some(({file})=>!state.selected.has(file.id)))notice('最多比较 8 份文件，未加入超出数量的结果。');state.mode='compare';counts();search();renderComparison();};
    $('clearSelected').onclick=()=>{state.selected.clear();state.mode='preview';counts();search();renderComparison();};
    $('returnComparison').onclick=()=>{state.mode='compare';counts();search();renderComparison();};
    $('closeNotice').onclick=()=>notice('');
    document.addEventListener('click',event=>{if(!event.composedPath().includes($('selectionToolbar')))$('selectionToolbar').open=false;});
    $('selectionToolbar').addEventListener('keydown',event=>{if(event.key==='Escape'){$('selectionToolbar').open=false;$('selectionToolbar').querySelector('summary').focus();}});
    $('closeDetail').onclick=()=>$('detailDialog').close();
    $('detailDialog').addEventListener('click',e=>{if(e.target===$('detailDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
    $('localFiles').onchange=e=>importFiles(e.target.files);
    ['logX','logY','showPoints','axisXMin','axisXMax','axisYMin','axisYMax'].forEach(id=>$(id).addEventListener('change',draw));
    $('parameter').onchange=()=>{$('axisYMin').value='';$('axisYMax').value='';draw();};
    $('plotXAxis').onchange=()=>{$('axisXMin').value='';$('axisXMax').value='';draw();};
    $('autoAxes').onclick=()=>{['axisXMin','axisXMax','axisYMin','axisYMax'].forEach(id=>$(id).value='');draw();};
    $('plotB').onchange=()=>{updateAngles();setRange(false);};$('plotAngle').onchange=()=>setRange(false);
    $('exportRaw').onclick=async()=>{const ids=state.plot.map(s=>s.entry.file.id);for(const id of ids)await rawDownload(id);};
    $('exportCsv').onclick=csv;$('exportSvg').onclick=()=>download('gas-comparison.svg',new XMLSerializer().serializeToString($('chart')),'image/svg+xml;charset=utf-8');
    window.addEventListener('hashchange',()=>view(location.hash.slice(1)));
    let depth=0;
    window.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();depth++;$('dropOverlay').hidden=false;}});
    window.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});
    window.addEventListener('dragleave',()=>{depth=Math.max(0,depth-1);if(!depth)$('dropOverlay').hidden=true;});
    window.addEventListener('drop',e=>{e.preventDefault();depth=0;$('dropOverlay').hidden=true;if(e.dataTransfer.files.length)importFiles(e.dataTransfer.files);});
  }
  async function init() {
    bind();view(location.hash.slice(1));enhanceSelects();
    try {
      const response=await fetch('catalog/gases.json',{cache:'no-cache'});if(!response.ok)throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(data.schema_version!==1||!Array.isArray(data.files))throw Error('不支持的目录格式');
      state.catalog=data;resetSearch();
      if(!state.preview&&!state.selected.size)state.preview=data.files[0]?.id||null;
      search();renderComparison();
      const p=data.reference_profile;
      $('referenceProfile').innerHTML=`<div class="profile-facts"><div><strong>${fmt(p.temperature_k-273.15)} °C</strong><span>温度</span></div><div><strong>${fmt(p.pressure_atm)} atm</strong><span>压强</span></div><div><strong>${p.magnetic_fields_t.map(fmt).join(' / ')} T</strong><span>磁场</span></div><div><strong>${p.angles_deg.map(fmt).join(' / ')}°</strong><span>夹角</span></div><div><strong>${p.electric_fields_v_cm.length} 点</strong><span>统一实际电场 E</span></div></div><p class="grid-points">${p.electric_fields_v_cm.map(fmt).join(' · ')} V/cm</p>`;
    }catch(error){notice(`目录暂时无法读取：${error.message}\n请通过 GitHub Pages 网站访问；本地预览可运行 python3 tools/catalog.py --serve。仍可添加本地文件进行比较。`);$('resultSubtitle').textContent='目录未加载';$('compareVisible').disabled=true;}
  }
  init();
})();
