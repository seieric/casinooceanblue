const express = require('express');
const router = express.Router();
const httpRequest = require('request');
const reCaptchaSecret = '6Lds1rwZAAAAAMl_dCpHQQ_7w0v2dhpfbAEQL3MN';
const sqlite = require('sqlite3').verbose();
const db = new sqlite.Database('./db/development.sqlite');

router.get('/count', function(req, res, next) {
    db.get("SELECT COUNT(id) FROM users WHERE is_active = 1", (err, row) => {
        if(err){
            console.log(`[SQLite]${err}`);
            res.status(500).send("Internal Server Error");
        }else{
            res.json(row['COUNT(id)']);
        }
    });
});
router.get('/ranking', function (req, res) {
   let ranking = {
       day: [
           {name: "tesuto", score: 180},
           {name: "Google", score: 54},
           {name: "Github", score: 33}
       ],
       hour: [
           {name: "tesuto", score: 360},
           {name: "Google", score: 348}
       ]
   };
   res.json(ranking);
});

//トークンとプレイヤー名の生成・更新
router.post('/start', function(req, res){
    //必須パラメータが不足している場合はエラー
   if(req.body.token == null || req.body.token === '' || req.body.playerName == null || req.body.playerName === ''){
       res.json({status: "error"});
   }else{
       let verificationURL = "https://www.google.com/recaptcha/api/siteverify"
       let options = {
           method: 'POST',
           url: verificationURL,
           json: false,
           form:{secret: reCaptchaSecret, response: req.body.token}
       };
       httpRequest(options,function(error,response,body) {
           body = JSON.parse(body);
           if(body.success && body.score > 0.3){
               //プレイヤー名とトークンをデータベースに格納する
               let playerName = req.body.playerName;
               let authToken = require('crypto').randomBytes(48).toString('hex');
               let time = new Date().getTime();

               if(req.body.authToken != null && req.body.authToken !== ''){
                   //トークンとプレイヤー名を更新する
                   let oldAuthToken = req.body.authToken;
                   db.serialize(() => {
                       let stmt = db.prepare("UPDATE users SET name = ?, token = ?, updated_at = ? WHERE token = ?");
                       stmt.run([playerName, authToken, time, oldAuthToken]);
                       console.log("update",res);
                   });
               }else{
                   //プレイヤー名を設定し、トークンを新規生成
                   db.serialize(() => {
                      let stmt = db.prepare("INSERT INTO users(name, token, updated_at, created_at) VALUES (?,?,?,?)");
                      stmt.run([playerName, authToken, time, time]);
                   });
               }
               res.json({status: "success", token: authToken});

           }else{
               res.json({status: "error"});
           }
       });
   }
});

module.exports = router;