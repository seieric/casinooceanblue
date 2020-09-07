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
    const ioRedis = require("socket.io-redis");
    io.adapter(ioRedis(redisConfig));

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
    io.use( (socket, next) => {
        let token = socket.handshake.query.token;
        let isAuthenticated = false;
        db.get("SELECT * FROM users WHERE token=?", [token], (error, row) => {
            if(error){
                return next(new Error("[SQLite]Something went wrong."));
            }
            if(row != null && row !== ""){
                socket._name = row.name;
                socket._gameId = "";
                socket._score = 0;
                isAuthenticated = true;
            }
            if(!isAuthenticated){
                return next(new Error('[Socket.io]Authentication error.'));
            }
            return next();
        });
    });

    // Socket.io ルーティング
    io.sockets.on('connection', socket => {
        console.log(`[Socket.io]Client(${socket.id}) connected!`);

        let isStarted, isJoined, isError;
        isStarted = isJoined = isError = false;

        redis.exists('rooms-waiting', (error, res) => {
            if(error){
                console.error(`[Redis]ERROR ${error}`);
                socket.disconnect();
                isError = true;
            }else if(parseInt(res) === 1){
                // データが存在した場合
                redis.lrange("rooms-waiting", 0, -1, (error, waitingGamesList) => {
                    if(error){
                        console.error(`[Redis]ERROR ${error}`);
                        socket.disconnect();
                        isError = true;
                    }else{
                        // 待ち列が空でないことの確認
                        if(waitingGamesList != null && waitingGamesList[0] != null){
                            let waitingGameId = waitingGamesList[0];
                            redisJsonGet(waitingGameId, (error, gameInfo) => {
                                if(error){
                                    console.error(`[Redis]ERROR ${error}`);
                                    socket.disconnect();
                                    isError = true;
                                }else{
                                    let numOfUsers = gameInfo.users.length;
                                    socket._gameId = waitingGameId;
                                    gameInfo.users.push(socket.id);
                                    redisJsonSet(waitingGameId, gameInfo);
                                    // 2人未満の場合待ち状態を維持・3人以上揃ったらゲーム開始
                                    if(2 <= numOfUsers){
                                        // 3人以上揃ったので待ち列から削除
                                        redis.rpush('rooms-waiting', waitingGamesList.shift());
                                        isStarted = true;
                                    }
                                    // ユーザーはルームに参加済
                                    isJoined = true;
                                }
                            });
                        }
                    }
                });
            }else{
                console.log(`[Redis]Couldn't read the store "rooms-waiting."`);
            }

            // ルームにまだ参加していな場合はゲームを作成
            if(!isJoined && !isError){
                // ルーム情報を初期化
                let gameInfo = {
                    id: require('crypto').randomBytes(12).toString('hex'),
                    users: [],
                    cards: [],
                    next: "",
                    token: require('crypto').randomBytes(6).toString('hex')
                };
                console.log("CHK", gameInfo);
                // ルームを新規作成して登録
                socket._gameId = gameInfo.id;
                gameInfo.users.push(socket.id);
                // トランプも初期化する
                for(let i=0;i<10;i++){
                    gameInfo.cards[i] = gameInfo.cards[i+10] = i;
                }
                let tmp, n;
                for(let i=0;i<20;i++){
                    n = Math.floor(Math.random() * 20);
                    tmp = gameInfo.cards[n];
                    gameInfo.cards[n] = gameInfo.cards[i];
                    gameInfo.cards[i] = tmp;
                }
                redisJsonSet(gameInfo.id, gameInfo);
                // ゲームを待ち列に登録
                redis.rpush('rooms-waiting', gameInfo.id);
                isJoined = true;
            }
            if(isJoined && !isError){
                // クライアントをルームに参加させる
                socket.join(socket._gameId);
            }

            // 開始フラグが立っていれば他の参加者に通知
            if(isStarted && !isError){
                io.to(socket._gameId).emit("start", "Game started.");
                redisJsonGet(socket._gameId, (error, gameInfo) => {
                    if(error){
                        console.log(`[Redis]Couldn't read the store "rooms-waiting."`);
                        socket.disconnect();
                        isError = true;
                    }
                    let startPos = gameInfo.users[0];
                    // 先頭の人が存在するか確認
                    redis.exists("client-" + startPos, (error, res) => {
                        if(error){
                            console.log(`[Redis]Couldn't read the store "rooms-waiting."`);
                            socket.disconnect();
                            isError = true;
                        }
                        if(parseInt(res) === 1){
                            io.to(startPos).emit("turn", {"token":gameInfo.token});
                        }
                    });
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
                    redis.get(userInfo.gameId, (error, gameInfo) => {
                        if (!error) {
                            let res = {};
                            res.first = gameInfo.cards[req.first];
                            res.second = gameInfo.cards[req.second];
                            if (res.first === res.second && res.first != null) {
                                gameInfo.cards[req.first] = gameInfo.cards[req.second] = null;
                            }
                            io.to(userInfo.gameId).emit("cardNotify", res);
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
            
            // ユーザーをゲーム情報から削除
            redisJsonGet(socket._gameId, (error, gameInfo) => {
                if(error){
                    console.log("[Redis]" + error, "Unable to access game data.");
                }else if(gameInfo != null){
                    gameInfo.users.some((v, i) => {
                        if (v===socket.id) gameInfo.users.splice(i,1);
                    });
                    redisJsonSet(socket._gameId, gameInfo);
                }
            });
        });

        // 例外処理
        socket.on('error', (details) => {
            console.error(`[Socket.io]Error ${details}`);
        });
    });
}