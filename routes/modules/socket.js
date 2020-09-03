const express = require('express');
const app = express();
const http = require("http").Server(app);
const io = require('socket.io')(http);


// 乱数生成器の初期化
const crypto = require("crypto");
const S = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const N = 16;

// Redisクライアントの初期化
//const redisConfig ={
//    host: process.env.REDIS_HOST,
//    port: process.env.REDIS_PORT,
//    password: process.env.REDIS_PASSWORD
//};
//const redis = require("redis").createClient(redisConfig);

//クライアントの生存確認
io.set('heartbeat interval', 5000);
io.set('heartbeat timeout', 15000);

//Socket.ioでの処理
io.sockets.on('connection', function(socket){
   console.log(`[Socket.io]Client(${socket.id}) connected!`);

   // Initialize client
   let userInfo = {};
   userInfo.gameId = "";
   userInfo.name = "";
   userInfo.score = 0;
   userInfo.token = "";
   redis.set("client-" + socket.id, userInfo);

   // ゲームに入室させる
   socket.on('join', (client) => {
       redis.get("client-" + socket.id, (error, userInfo) => {
           if(error){
               console.log("[Redis]" + error);
           }else if (client.gameId != null) {
               socket.emit("error", "invalid request");
               console.log(`[Socket.io]Client(${socket.id}) tried join the game again. Invalid request.`);
           } else {
               let isJoined = false;
           }
       });
   });

   //カードの照合
    socket.on('cardOpen', (req) => {
        redis.get("client-" + socket.id, (error, userInfo) => {
           if(error){
               console.log("[Redis]" + error, "Request name was 'cardOpen'");
           } else if (client.gameId != null){
               console.log(`[Socket.io]Client(${socket.id}) tried join the game again. Invalid request.`);
           } else {
               redis.get("game-" + userInfo.gameId, (error, gameInfo) => {
                   if (!error) {
                       let res = {};
                       res.first = gameInfo.cards[req.first];
                       res.second = gameInfo.cards[req.second];
                       if (res.first === res.second && res.first != null) {
                           gameInfo.cards[req.first] = gameInfo.cards[req.second] = null;
                       }
                       socket.to(userInfo.gameId).emit("cardNotify", res);
                   } else {
                       console.log("[Redis]" + error, "Unable to access game data.");
                   }
               });
           }
        });
    });

   // プレイヤー名を設定
   socket.on('setName', (client) => {
       redis.get("client-" + socket.id, (error, userInfo) => {
           if(error){
               console.error("[Redis]" + error);
           }else{
               if(client.name == null){
                   console.log(`[Socket.io]Client(${socket.id}) sent invalid request.`);
               }else{
                   userInfo.name = client.name;
                   console.log(`[Socket.io]Client(${socket.id}) set name "${user.name}"`);
               }
           }
       });
   });

   // 切断時の処理
   socket.on('disconnect', function(d){
       console.log(`[Socket.io]Client(${socket.id}) disconnected.`);
       // ユーザーのデータを消去
       redis.del(socket.id);
   });

   // 例外処理
   socket.on('error', (details) => {
      console.error(`[Socket.io]Error ${details}`);
   });
});