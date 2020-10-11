const express = require('express');
const router = express.Router();
const httpRequest = require('request');
const reCaptchaSecret = '6Lds1rwZAAAAAMl_dCpHQQ_7w0v2dhpfbAEQL3MN';
const db = require('../routes/modules/database');

router.get('/ranking', function (req, res) {
    const query = {
        text: "select * from results order by score desc, id desc limit 10;"
    }
    db.query(query, (err, result) => {
        if(err){
            res.status(500);
            res.send('DB ERROR');
        }else {
            let ranking = {total: [], hour: []};
            let i = 0;
            while (i < result.rowCount) {
                delete result.rows[i].id;
                delete result.rows[i].created_at;
                ranking.total.push(result.rows[i]);
                i++;
            }
            res.json(ranking);
        }
    });
    let ranking = {
        day: [
           {name: "tesuto", score: 180},
           {name: "Google", score: 54},
           {name: "Github", score: 33}
       ],
       hour: []
   };
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
       httpRequest(options,async function(error,response,body) {
           body = JSON.parse(body);
           if(body.success && body.score > 0.3){
               //プレイヤー名とトークンをデータベースに格納する
               const playerName = req.body.playerName;
               const authToken = require('crypto').randomBytes(48).toString('hex');
               const time = new Date();
               let isError = false;

               // ユーザーが該当するか確認
               let isHit = false;
               const query = {
                   text: "SELECT * FROM users WHERE token = $1",
                   values: [authToken]
               };
               await db.query(query, (err, result) => {
                  if(err){
                      console.log(err);
                      isError = false;
                  }else{
                      if(result.rowCount === 1){
                          console.log("[API] User data was found.")
                          isHit = true;
                      }
                  }
               });

               if(isHit){
                   //トークンとプレイヤー名を更新する
                   let oldAuthToken = req.body.authToken;
                   const query = {
                       text:"UPDATE users SET name = $1, token = $2, updated_at = $3 WHERE token = $4",
                       values: [playerName, authToken, time, oldAuthToken]
                   };
                   await db.query(query, (err, result) => {
                      if(err){
                          console.log(err);
                          isError = false;
                      }
                   });
                   console.log("[API] Updated user data.");
               }else{
                   const query = {
                       text: "INSERT INTO users(name, token, updated_at, created_at) VALUES ($1,$2,$3,$4)",
                       values: [playerName, authToken, time, time]
                   };
                   await db.query(query, (err, result) => {
                       if(err){
                           console.log(err);
                           isError = false;
                       }
                   });
                   console.log("[API] Created user data.");
               }
               if(!isError){
                   res.json({status: "success", token: authToken});
               }else{
                   res.json({status: "error"});
               }

           }else{
               res.json({status: "error"});
           }
       });
   }
});

module.exports = router;