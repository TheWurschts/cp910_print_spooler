'use strict';
var shell = require('shelljs');
// var commander = require('commander');
const Hapi = require('hapi');
const sha256 = require('sha256');
const moment = require('moment');
const alasql = require('alasql');

var auftraege = [];
var printActive = false;
var currentJob = null;

const server = new Hapi.Server();
server.connection({
    host: 'localhost',
    port: 38163
});

server.route({
  method: 'POST',
  path:'/setJob',
  handler: function (request, reply) {
    try{
      let JSONObject = JSON.parse(request.payload);
      let count = 1;
      if(JSONObject.count){
        count = JSONObject.count;
      }
      let shaArr = [];
      for(var i=0;i<count;i++){
        let newsha = moment() + sha256(JSONObject.file + i)
        auftraege.push({"file":JSONObject.file+i, "time":moment().format('x'), "prio":i, "id":newsha});
        shaArr.push(newsha)
      }
      sortOrder();
      console.log(auftraege)
      return reply({"success":true, "id":shaArr});
    }catch(e){
      return reply({"success":false});
    }
  }
});
server.route({
  method: 'GET',
  path:'/jobStatus/{id}',
  handler: function (request, reply) {
    let id = request.params.id;
    if(!isIdInArray(id)){
      return reply({"finished":true});
    }else{
      return reply({"finished":false});
    }
  }
});

// Start the server
server.start((err) => {

    if (err) {
        throw err;
    }
    console.log('Server running at:', server.info.uri);
});


var sortOrder = function(){
  auftraege = alasql('SELECT * FROM ? ORDER BY time, prio', [auftraege]);
}

var isIdInArray = function(id){
  return auftraege.some(function(item, idx){
    return item.id === id;
  });
}
var removeIDFromArray = function(id){

  auftraege.some(function(item, idx){
    if(item.id === id){
      auftraege.splice(idx, 1);
      return true;
    }else{
      return false;
    }
  })
  currentJob = null;
}

var printIfAvailable = function(){
  // console.log(printActive, currentJob, auftraege)
  if(!printActive && auftraege.length>0){
    printActive = true;

    currentJob = auftraege[0].id+'';
    let id = auftraege[0].id+'';
    let filename = auftraege[0].file+'';

    let child = shell.exec('/home/roman/bzr/selphy/selphy -printer_mac "60:12:8B:A3:E9:D0" '+filename, {async:true, silent:true});
    child.stdout.on('data', function(data) {
      /* ... do something with data ... */
      var bla = filterEmptyVars(data.split("\n"));
console.log(bla)
      if(bla[0]=='state 3'){
        console.log('finished')
        removeIDFromArray(id);
        printActive=false;
      }
      let isError = bla.some(function(item){
        return item == 'Help! No TCP port to connect to..';
      })
      if(isError){

      }

    });
    child.stdout.on('end', function(){
      console.log('end ', id)
    })
  }
}
setInterval(function(){
  sortOrder();
  printIfAvailable();
},1000)

// var child = shell.exec('/home/roman/bzr/selphy/selphy -printer_mac "60:12:8B:A3:E9:D0" /tmp/test.jpg', {async:true, silent:true});
// child.stdout.on('data', function(data) {
//   /* ... do something with data ... */
//   var bla = data.split("\n");
//   console.log(filterEmptyVars(bla))
//   // console.log('data', data)
// });
// child.stdout.on('end', function(){
//   console.log('end')
// })
//
var filterEmptyVars = function(array){
  array = array || [];
  return array.filter(function(item){
    return item !== '';
  })
}
