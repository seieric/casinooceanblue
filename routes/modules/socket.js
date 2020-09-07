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
    /**
     * クライアントにエラー発生を通知
     * @param socket
     */
    function sendError(socket){
        io.to(socket.id).emit('finish', {status:'exception'});
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

        redis.lrange("rooms-waiting", 0, -1, (error, waitingGamesList) => {
            if(!error){
                console.debug("Waiting games list is now " + JSON.stringify(waitingGamesList));

                // 待ち列が空でないことの確認
                if(waitingGamesList != null && waitingGamesList != ""){
                    let waitingGameId = waitingGamesList[0];
                    redisJsonGet(waitingGameId, (error, gameInfo) => {
                        console.debug("[DEBUG] gameInfo is now" + JSON.stringify(gameInfo));
                        if(error){
                            console.error(`[Redis]ERROR ${error}`);
                            sendError(socket);
                        }else{
                            let numOfUsers = gameInfo.users.length;
                            console.debug(`[DEBUG] ${gameInfo.id} has ${numOfUsers} now.`);
                            socket._gameId = waitingGameId;
                            gameInfo.users.push(socket.id);
                            redisJsonSet(waitingGameId, gameInfo);
                            // 2人未満の場合待ち状態を維持・3人以上揃ったらゲーム開始
                            if(2 <= numOfUsers){
                                console.debug(`[DEBUG] ${gameInfo.id} has been started now.`);
                                // 3人以上揃ったので待ち列から削除
                                console.debug(`[DEBUG] Waiting games list(before) is now ${JSON.stringify(waitingGamesList.shift())}`);
                                console.debug(`[DEBUG] Waiting games list(tmp) is now ${JSON.stringify(waitingGamesList.shift())}`);
                                if(waitingGamesList.shift != null && waitingGamesList != ""){
                                    redis.rpush('rooms-waiting', waitingGamesList.shift);
                                }else{
                                    redis.del('rooms-waiting');
                                }
                                io.to(socket._gameId).emit('start', {'n':numOfUsers + 1});
                            }
                            // ユーザーはルームに参加済
                            socket.join(socket._gameId);
                            console.log(`Client(${socket.id}) joined the game ${socket._gameId}`);
                        }
                    });
                }else{
                    console.debug("[DEBUG] Create new game.");
                    // ルーム情報を初期化
                    let gameInfo = {
                        id: require('crypto').randomBytes(12).toString('hex'),
                        users: [],
                        cards: [],
                        next: "",
                        token: require('crypto').randomBytes(6).toString('hex')
                    };
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
                    console.debug("[DEBUG] New gameInfo is ", JSON.stringify(gameInfo));
                    redisJsonSet(gameInfo.id, gameInfo);
                    // ゲームを待ち列に登録
                    redis.rpush('rooms-waiting', gameInfo.id);

                    socket.join(socket._gameId);
                    console.log(`Client(${socket.id}) joined the game ${socket._gameId}`);
                }
            }else{
                console.error(`[Redis]ERROR ${error}`);
                sendError(socket);
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
                    if(gameInfo.users.length <= 1){
                        io.to(socket._gameId).emit('finish', {'status':'exception'});
                        redis.del(socket._gameId);
                    }else{
                        redisJsonSet(socket._gameId, gameInfo);
                    }
                }
            });
        });

        // 例外処理
        socket.on('error', (details) => {
            console.error(`[Socket.io]Error ${details}`);
        });
    });
}