/**
 * socket.ioのルーティング
 * @param io
 */
module.exports = (io) => {
    // Redisクライアントの初期化
    const redisConfig ={
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD
    };
    const redis = require("redis").createClient(redisConfig);

    /**
     * redisからJSONオブジェクトを取り出す
     * @param key
     * @param func
     */
    function redisJsonGet(key, func){
        redis.get(key, (error, res) => {
           func(error, JSON.parse(res));
        });
    }
    /**
     * redisにJSONオブジェクトをストアする
     * @param key
     * @param data
     */
    function  redisJsonSet(key, data){
        redis.set(key, JSON.stringify(data));
    }

    // SQLiteクライアントの初期化
    const sqlite = require("sqlite3").verbose();
    const db = new sqlite.Database("./db/development.sqlite");

    // クライアントの生存確認
    io.set('heartbeat interval', 5000);
    io.set('heartbeat timeout', 10000);

    // redisの待ち列を初期化
    redis.del('rooms-waiting');

    // クライアントの認証
    io.use((socket, next) => {
        let token = socket.handshake.query.token;
        db.get("SELECT * FROM users WHERE token=?", [token], (error, row) => {
            if(row === null || row === "" || row.name === ""){
                return next(new Error('authentication error'));
            }else{
                redis.exists("client-" + socket.id, (error, res) => {
                    // ユーザー情報が存在しなかった場合
                    if(parseInt(res) !== 1){
                        // ユーザーデータを初期化
                        let userInfo = {};
                        userInfo.gameId = "";
                        userInfo.name = row.name;
                        userInfo.score = 0;
                        // redisにユーザー情報を登録
                        redisJsonSet("client-" + socket.id, userInfo);
                        console.log(`[Socket.io]Client(${socket.id}) is registered to redis.`);
                    }
                    return next();
                });
            }
        });
    });

    // Socket.io ルーティング
    io.sockets.on('connection', (socket) => {
        console.log(`[Socket.io]Client(${socket.id}) connected!`);

        // 開始通知用のフラグ
        let isStart = false;
        // ルーム参加フラグ
        let isJoined = false;
        redisJsonGet("client-" + socket.id, (error, userInfo) => {
            if(error){
                console.error(`[Redis] Failed to get user data. > ${error}`);
            }else{
                // 入室待ちのルームを検索
                 redis.exists('rooms-waiting', (error, res) => {
                    if(parseInt(res) === 1){
                        console.log("chekc point 1");
                        // データが存在した場合
                        let waitingGamesList = redis.lrange('rooms-waiting', 0, -1);
                        // 待ち列が空でないことの確認
                        if(waitingGamesList !== null){
                            let waitingGameId = waitingGamesList[0];
                            redisJsonGet(waitingGameId, (error, gameInfo) => {
                                if(error){
                                    console.error(`[Redis] Failed to get game data. > ${error}`);
                                }else{
                                    let numOfUsers = gameInfo.users.length;
                                    userInfo.gameId = waitingGameId;
                                    gameInfo.users.push(socket.id);
                                    redisJsonSet(waitingGameId, gameInfo);
                                    // 2人未満の場合待ち状態を維持・3人以上揃ったらゲーム開始
                                    if(2 <= numOfUsers){
                                        // 3人以上揃ったので待ち列から削除
                                        redis.rpush('rooms-waiting', waitingGamesList.shift());
                                        isStart = true;
                                    }
                                    // ユーザーはルームに参加済
                                    isJoined = true;
                                }
                            });
                        }
                    }else{
                        // データが存在しない場合
                        console.log(`[Redis]Couldn't read the store "rooms-waiting."`);
                    }

                    // ルームにまだ参加していな場合はゲームを作成
                    if(!isJoined){
                        // ルーム情報を初期化
                        let gameInfo = {};
                        gameInfo.id = "";
                        gameInfo.users = [];
                        // ルームを新規作成して登録
                        let gameId = require('crypto').randomBytes(12).toString('hex');
                        userInfo.gameId = gameId;
                        gameInfo.id = gameId;
                        gameInfo.users.push(socket.id);
                        redisJsonSet(gameId, gameInfo);
                        // ゲームを待ち列に登録
                        redis.rpush('rooms-waiting', [gameId]);
                    }

                     // クライアントをルームに参加させ、ユーザー情報を登録
                     socket.join(userInfo.gameId);
                     redisJsonSet("client-" + socket.id, userInfo);
                     // 開始フラグが立っていれば他の参加者に通知
                     if(isStart){
                         io.to(userInfo.gameId).emit("start", "Game started.");
                     }
                });
            }
        });

        // トリガー別の処理
        // カードの照合
        socket.on('cardOpen', (req) => {
            redis.get("client-" + socket.id, (error, userInfo) => {
                if(error){
                    console.log("[Redis]" + error, "Request name was 'cardOpen'");
                } else if (userInfo.gameId != null){
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

        // 切断時の処理
        socket.on('disconnect', () => {
            console.log(`[Socket.io]Client(${socket.id}) disconnected.`);
            // ユーザーをゲームから削除
            redisJsonGet("client-" + socket.id, (error, userInfo) => {
               if(error){
                   console.error("[Redis] Failed to get user data. > " + error);
               }else{
                   redisJsonGet(userInfo.gameId, (error, gameInfo) => {
                       gameInfo.users.some((v, i) => {
                           if (v===socket.id) gameInfo.users.splice(i,1);
                       });
                       redisJsonSet('game-' + userInfo.gameId, gameInfo);
                   });
               }
            });
            // 最後にデータも削除する
            redis.del("client-" + socket.id);
        });

        // 例外処理
        socket.on('error', (details) => {
            console.error(`[Socket.io]Error ${details}`);
        });
    });
}