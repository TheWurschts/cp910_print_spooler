'use strict';
var shell = require('shelljs');
// var commander = require('commander');
const Hapi = require('hapi');
const sha256 = require('sha256');
const moment = require('moment');
const alasql = require('alasql');
const push = require('pushover-notifications');
const Datastore = require('nedb');
const Async = require('async');
const Path = require('path');
const fs = require('fs');
const cfg = require('./config.json');
var db = new Datastore({ filename: Path.join(__dirname,'data.db'), autoload: true });

db.ensureIndex({ fieldName: 'id', unique: true }, function (err) {
});
let pushover = new push( {});

var printActive = false;
var currentJob = null;

const server = new Hapi.Server();
server.connection({
    host: 'localhost',
    port: 38163
});
// db.find({}).sort({ time: 1, prio: 1 }).limit(1).exec(function (err, docs) {
//   docs.forEach(function(item){
//     console.log(item);
//   })
// })
// {"file":"/tmp/test.jpg","count":4,"perroruser":"pushoveruser","perrortoken":"pushovertoken"}

server.route({
  method: 'POST',
  path:'/setJob',
  handler: function (request, reply) {
    try{
      let JSONObject;
      if(typeof request.payload !== 'object'){
        JSONObject = JSON.parse(request.payload);
      }else{
        JSONObject = request.payload;
      }
      let count = 1;
      if(JSONObject.count){
        count = JSONObject.count;
      }
      let shaArr = [];
      // TODo check if file is present and is jpg
      try{
        fs.statSync(JSONObject.file);
      }catch(e){
        return reply({"success":false, "message":"file not found"});
      }
      for(var i=0;i<count;i++){
        let newsha = moment() + sha256(JSONObject.file + i)
        let newObj = {"file":JSONObject.file, "time":moment().format('x'), "prio":i, "id":newsha, "finished":0};
        try{
          newObj.pErrorUser = JSONObject.perroruser;
          newObj.pErrorToken = JSONObject.perrortoken;
        }catch(e){}
        db.insert(newObj);

        // auftraege.push({"file":JSONObject.file+i, "time":moment().format('x'), "prio":i, "id":newsha, "pUser":JSONObject.puser});
        db.find({}).sort({ time: 1, prio: 1 }).limit(1).exec(function (err, docs) {
          docs.forEach(function(item){
            console.log(item);
          })
        })
        shaArr.push(newsha)
      }
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

server.route({
  method: 'GET',
  path:'/jobDelete/{id}',
  handler: function (request, reply) {
    let id = request.params.id;
    removeIDFromDB(id, function(err, numRows){
      if(!!numRows){
        return reply({"finished":true});
      }else{
        return reply({"finished":false});
      }
    });
  }
});

// Start the server
server.start((err) => {
  if (err) {
    throw err;
  }
  console.log('Server running at:', server.info.uri);
});


var isIdInArray = function(id){
  db.count({ id: id }, function (err, count) {
    return !!count;
  });
}
var removeIDFromDB = function(id, cb){
  if(typeof cb !== 'function'){
    cb = function(){};
  }
  currentJob = null;
  db.update({ id: id }, { $set: { finished: 1, finishedtimestamp: moment().format('x') } },{}, cb);
}

var printIfAvailable = function(){
  db.count({finished: 0}, function (err, count) {
    // console.log(printActive, currentJob, auftraege)
    if(!printActive && count>0){
      printActive = true;
      db.find({finished: 0}).sort({ prio: 1, time: -1 }).limit(1).exec(function (err, docs) {
        if(err || docs.length === 0){
          console.log(err);
          printActive = false;
        }else{
          if(typeof docs === 'object'){
            docs = docs[0];
          }
          console.log('Printing: ', docs.file)
          currentJob = docs.id+'';
          let id = docs.id+'';
          let filename = docs.file+'';
          let state0 = 0;
          let state0Timer = null;
          let state0TooLong = false;
          let state0TooLongFlip = false;
          let printerNotRespondingTimer = null;

          console.log(cfg.selphyPath + ' -printer_mac "60:12:8B:A3:E9:D0" '+filename)
          let child = shell.exec(cfg.selphyPath + ' -printer_mac "60:12:8B:A3:E9:D0" '+filename, {async:true, silent:true});
          child.stdout.on('data', function(data) {
            var bla = filterEmptyVars(data.split("\n"));

            clearTimeout(printerNotRespondingTimer);
            printerNotRespondingTimer = setTimeout(function(){
              // console.log(docs.pNRCount,isPartableByNine(docs.pNRCount))
              Async.series([
                function(callback){
                  if(!docs.pNRCount || isPartableByNine(docs.pNRCount)){
                    let isError = bla.some(function(item){
                      return item == 'Help! No TCP port to connect to..';
                    })
                    let pMsg = null;
                    if(!isError){
                      pMsg = "Printer is not responding...."
                    }
                    sendErrorPushover(docs, pMsg, callback);
                  }else{
                    callback();
                  }
                },function(callback){
                  updatePrinterNotResponseCounter(id, docs.pNRCount ? docs.pNRCount+1 : 1 );
                  printActive = false;
                  console.log('killing child process')
                  child.kill('SIGINT');
                  callback();
                }
              ])
            }, 3000);

            console.log(bla)
            if(bla[0] == 'state 0'){
              state0++;
            }else{
              state0 = 0;
            }
            if(state0 != 0 && state0 > 30){
              if(!state0TooLong && !state0TooLongFlip){
                state0TooLongFlip = true;
                setTimeout(function(){
                  state0TooLong = true;
                }, 90000); //druckdauer
              }
              if(state0TooLong){
                sendErrorPushover(docs, 'Check Printer... ? Paper/Ink ?');
                state0TooLong = false;
                state0TooLongFlip = false;
              }
            }else{
              clearTimeout(state0Timer);
              state0TooLongFlip = false;
              state0TooLong = false;
            }
            if(bla[0] == 'state 3'){
              clearTimeout(state0Timer);
              console.log('finished')
              removeIDFromDB(id);
              printActive=false;
            }
            // let isError = bla.some(function(item){
            //   return item == 'Help! No TCP port to connect to..';
            // })
            // if(isError){
            //   // send pushover
            //   sendErrorPushover(docs);
            // }

          });
          child.stdout.on('end', function(){
            clearTimeout(printerNotRespondingTimer);
            printActive = false;
            console.log('end ', id)
          })
        }
      });
    }
  });
}
setInterval(function(){
  printIfAvailable();
},1000)

var sendErrorPushover = function(data, message, cb){

  if(data.pErrorUser && data.pErrorToken){
    let msg = {
      user: data.pErrorUser,
    	token: data.pErrorToken
    };
    if (message == null){
      msg.message = "There is a problem printing the file: "+data.file+ ' id:' + data.id;
    }else{
      msg.message = message;
    }
    let cbSent = false;
    setTimeout(function(){
      if(typeof cb === 'function' && !cbSent){
        cbSent = true;
        cb();
      }
    },10000);
    pushover.send( msg, function( err, result ) {

    	if ( err ) {
    		console.error('Pushover sending not succesfull:', err)
    	}else{
    	   console.log('Pushover succesfull:', result );
      }
      if(typeof cb === 'function' && !cbSent){
        cbSent = true;
        cb();
      }
    });
  }else{
    console.log('no pushover data found')
    if(typeof cb === 'function' && !cbSent){
      cbSent = true;
      cb();
    }
  }
}

var updatePrinterNotResponseCounter = function(id, newCount){
  db.update({ id: id }, { $set: { pNRCount: newCount } });
}
var filterEmptyVars = function(array){
  array = array || [];
  return array.filter(function(item){
    return item !== '';
  })
}
function isEven(n) {
   return n % 2 == 0;
}
function isPartableByNine(n) {
   return n % 9 == 0;
}
