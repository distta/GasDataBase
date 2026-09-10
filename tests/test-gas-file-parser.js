'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const parser=require('../assets/js/gas-file-parser.js');

const root=path.resolve(__dirname,'..');
const gasRoot=path.join(root,'GasDataBase');

function gasFiles(directory){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const fullPath=path.join(directory,entry.name);
    if(entry.isDirectory())return gasFiles(fullPath);
    return ['.json','.md','.pdf'].includes(path.extname(entry.name).toLowerCase())?[]:[fullPath];
  });
}

const files=gasFiles(gasRoot);
assert.ok(files.length>0,'No gas files found for parser regression testing.');

for(const file of files){
  const gas=parser.parse(fs.readFileSync(file,'utf8'),path.basename(file));
  assert.equal(gas.records.length,gas.nE*gas.nAngles*gas.nB,file);
  assert.equal(gas.parsedValues,gas.actualRecordSize*gas.records.length,file);
  assert.equal(gas.extraValues,gas.extraValuesPerRecord*gas.records.length,file);
}

console.log(`Shared gas parser validated ${files.length} published files.`);
