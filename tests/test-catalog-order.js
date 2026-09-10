(function () {
  const M = typeof require === 'function' ? require('../assets/js/catalog-model.js') : GasCatalogModel;
  const check = (actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(JSON.stringify({actual, expected}));
  };
  const file = (id, ar, pressure = 1, temperature = 293.15, extra = false) => ({
    id, components: [{name: 'Ar', fraction: ar}, {name: 'CF4', fraction: 100-ar}, ...(extra ? [{name: 'CO2', fraction: 1}] : [])],
    pressure_atm: pressure, temperature_k: temperature
  });
  const query = {components: [{name: 'Ar', fraction: 80}, {name: 'CF4', fraction: 20}]};
  const files = [file('extra',80,1,293.15,true), file('far',79), file('hot',80,1,310), file('pressure',80,2), file('exact',80)];
  check(files.slice().sort((a,b)=>M.compareFiles(a,b,query)).map(f=>f.id), ['pressure','hot','exact','far','extra']);
  const recipes = [file('low',70),file('high',90),file('middle',80)];
  check(recipes.slice().sort((a,b)=>M.compareFiles(a,b,{components:[]})).map(f=>f.id), ['high','middle','low']);
  check(recipes.slice().sort((a,b)=>M.compareTableFiles(a,b,query,'recipe',1)).map(f=>f.id), ['low','middle','high']);
  check(recipes.slice().sort((a,b)=>M.compareTableFiles(a,b,query,'recipe',-1)).map(f=>f.id), ['high','middle','low']);
  check(['CF4','Xe','iC4H10','Ne','Ar','He'].sort(M.componentOrder), ['He','Ne','Ar','Xe','CF4','iC4H10']);
  const wildcard = () => ({name:'',fraction:null});
  const filter = {text:'', components:[wildcard(),wildcard(),wildcard()], temperature:null, pressure:null,
    b:null, angle:null, minE:null, maxE:null, fractionTolerance:1, exactSet:true, partial:true};
  const sample = names => ({components:names.map(name=>({name,fraction:100/names.length})),
    label:'sample', path:'sample', family:'sample', identifier:'sample', electric_fields:[100,1000]});
  const binary=sample(['Ar','CO2']), ternary=sample(['Ar','CO2','CF4']), other=sample(['C2H2F4','iC4H10','SF6']);
  check(Boolean(M.match(binary,filter)),false);
  check(Boolean(M.match(ternary,filter)),true);
  check(Boolean(M.match(sample(['Ar','CO2','CF4','CH4']),filter)),false);
  const arFilter={...filter,components:[{name:'Ar',fraction:null},wildcard(),wildcard()]};
  check(Boolean(M.match(ternary,arFilter)),true);
  check(Boolean(M.match(other,arFilter)),false);
  check(Boolean(M.match(binary,{...filter,components:[wildcard(),wildcard()]})),true);
  check(Boolean(M.match(sample(['He']),{...filter,components:[wildcard()]})),true);
  const mixture={...ternary,components:[{name:'Ar',fraction:80},{name:'CO2',fraction:15},{name:'CF4',fraction:5}]};
  check(Boolean(M.match(mixture,{...filter,components:[{name:'',fraction:80},{name:'Ar',fraction:80},wildcard()]})),false);
  check(Boolean(M.match(mixture,{...filter,components:[{name:'',fraction:5},{name:'Ar',fraction:80},wildcard()]})),true);
  check(M.validateQuery({...filter,components:[{name:'',fraction:80},wildcard(),wildcard()]}),'');
  const fuzzyQuery={...filter,fuzzyMatching:true,components:[{name:'Ar',fraction:83},{name:'CF4',fraction:17}]};
  const nearMixture={...binary,...file('near',80)},farMixture={...binary,...file('far',90)};
  check(Boolean(M.match(nearMixture,fuzzyQuery)),true);
  check(Boolean(M.match(nearMixture,{...fuzzyQuery,fuzzyMatching:false})),false);
  check([farMixture,nearMixture].sort((a,b)=>M.compareFiles(a,b,fuzzyQuery)).map(f=>f.id),['near','far']);
  const wildcardQuery={...fuzzyQuery,components:[{name:'',fraction:18},{name:'Ar',fraction:null}]};
  check([farMixture,nearMixture].sort((a,b)=>M.compareFiles(a,b,wildcardQuery)).map(f=>f.id),['near','far']);
  check(Boolean(M.match(ternary,fuzzyQuery)),false);
  check(Boolean(M.match(other,fuzzyQuery)),false);
  const thermoQuery={...fuzzyQuery,temperature:21,pressure:.95};
  const closeThermo={...nearMixture,id:'closeThermo',temperature_k:293.15,pressure_atm:1};
  const farThermo={...nearMixture,id:'farThermo',temperature_k:303.15,pressure_atm:2};
  check(Boolean(M.match(closeThermo,thermoQuery)),true);
  check(Boolean(M.match(farThermo,thermoQuery)),true);
  check([farThermo,closeThermo].sort((a,b)=>M.compareFiles(a,b,thermoQuery)).map(f=>f.id),['closeThermo','farThermo']);
  check(Boolean(M.match(closeThermo,{...thermoQuery,fuzzyMatching:false,components:[{name:'Ar',fraction:80},{name:'CF4',fraction:20}]})),false);
  check([farThermo,closeThermo].sort((a,b)=>M.compareFiles(a,b,{...thermoQuery,temperature:0,pressure:null})).map(f=>f.id),['closeThermo','farThermo']);
  console.log('Gas component ordering and relevance sorting passed.');
})();
