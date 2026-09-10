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
  check(['CF4','Xe','iC4H10','Ne','Ar','He'].sort(M.componentOrder), ['Ar','He','Ne','Xe','CF4','iC4H10']);
  console.log('Gas component ordering and relevance sorting passed.');
})();
