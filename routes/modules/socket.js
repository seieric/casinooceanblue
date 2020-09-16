/**
 * socket.ioのルーティング
 * @param io
 */
module.exports = (io) => {
    // Redisクライアントの初期化
    const redisConfig ={
        url: process.env.REDISCLOUD_URL
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

    // PostgreSQLクライアントの初期化
    const db = require('../modules/database');

    // クライアントの生存確認
    io.set('heartbeat interval', 5000);
    io.set('heartbeat timeout', 10000);

    // redisの待ち列を初期化
    redis.del('rooms-waiting');

    // クライアントの認証
    io.use( async (socket, next) => {
        const token = socket.handshake.query.token;
        let isAuthenticated = false;
        const query = {
            text: "SELECT * FROM users WHERE token=$1",
            values: [token]
        };
        await db.query(query, (err, result) => {
            if(err){
                return next(new Error("[SQLite]Something went wrong."));
            }
            if(result.rowCount === 1){
                socket._name = result.rows[0].name;
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

    // 2秒毎にトークンの更新を確認
    setInterval(() => {
        const rooms = io.sockets.adapter.rooms;
        for(let roomId in rooms){
            if(rooms[roomId].length >= 2){
                redisJsonGet(roomId, (err, gameInfo) => {
                    const now = new Date();
                    if(gameInfo.tokenExpire !== null && gameInfo.isStarted){
                        // トークンの有効期限が過ぎていれば更新
                        if(gameInfo.tokenExpire < now){
                            const expire = 15;
                            gameInfo.token = require('crypto').randomBytes(12).toString('hex');
                            gameInfo.tokenExpire = new Date(new Date().getTime() + expire*1000);
                            if((gameInfo.users.length - 1) <= gameInfo.next){
                                gameInfo.next = 0;
                            }else{
                                gameInfo.next += 1;
                            }
                            io.to(gameInfo.users[gameInfo.next]).emit('turn', {token: gameInfo.token});
                            console.debug("Token has been updated!");
                            redisJsonSet(gameInfo.id, gameInfo);
                        }
                    }
                });
            }
        }
    }, 2000);

    // Socket.io ルーティング
    io.sockets.on('connection', socket => {
        console.log(`[Socket.io]Client(${socket.id}) connected!`);

        redis.lrange("rooms-waiting", 0, -1, (error, waitingGamesList) => {
            if(!error){
                console.debug("Waiting games list is now " + JSON.stringify(waitingGamesList));

                // 待ち列が空でないことの確認
                if(waitingGamesList != null && waitingGamesList != ""){
                    let waitingGameId = waitingGamesList[0];
                    console.debug("[DEBUG] waitingGameId is now" + waitingGameId);
                    redisJsonGet(waitingGameId, (error, gameInfo) => {
                        console.debug("[DEBUG] gameInfo is now" + JSON.stringify(gameInfo));
                        if(error){
                            console.error(`[Redis]ERROR ${error}`);
                            sendError(socket);
                        }else if(gameInfo != null){
                            let numOfUsers = gameInfo.users.length;
                            console.debug(`[DEBUG] ${gameInfo.id} has ${numOfUsers} now.`);
                            socket._gameId = waitingGameId;
                            gameInfo.users.push(socket.id);
                            redisJsonSet(waitingGameId, gameInfo);
                            // ユーザーはルームに参加済
                            socket.join(socket._gameId);
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
                                // ゲーム開始のシグナルを送る
                                gameInfo.isStarted = true;
                                io.to(socket._gameId).emit('start', {'n':numOfUsers + 1});
                                io.to(gameInfo.users[0]).emit('turn', {token:gameInfo.token});
                                console.debug(`First user is ${gameInfo.users[0]}`);
                                // 配列の前から２番めのユーザーが次のプレイヤー
                                gameInfo.next = 1;
                                // トークンの制限時間を15秒に設定
                                const tokenExpire = 15;
                                gameInfo.tokenExpire = new Date(new Date().getTime() + tokenExpire*1000);
                                redisJsonSet(gameInfo.id, gameInfo);
                                console.debug("Game started.");
                            }
                            console.log(`Client(${socket.id}) joined the game ${socket._gameId}`);
                            console.debug(numOfUsers + "in the game");
                        }
                    });
                }else{
                    console.debug("[DEBUG] Create new game.");
                    // ルーム情報を初期化
                    let gameInfo = {
                        id: require('crypto').randomBytes(12).toString('hex'),
                        users: [],
                        cards: [],
                        next: 0,
                        token: require('crypto').randomBytes(6).toString('hex'),
                        tokenExpire: "",
                        cardTmp: null,
                        isStarted: false
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
                    let s = redisJsonSet(gameInfo.id, gameInfo);
                    console.debug("[DEBUG] gameInfo is register to redis. " + s);
                    redisJsonGet(gameInfo.id, (err, res) => {
                        console.debug("[DEBUG] gameInfo is now. " + JSON.stringify(res));
                    });
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
        socket.on('cardOpen', (data) => {
            console.debug("[DEBUG]Receive card opening.");
            console.debug(JSON.stringify(data));
            const gameId = socket._gameId;
            redisJsonGet(gameId, (error, gameInfo) => {
                if(!error){
                    // トークンを照合
                    if(data.token === gameInfo.token){
                        console.debug("[DEBUG]User authorized.");
                        let res;
                        if(gameInfo.cardTmp != null){
                            // 2枚目の処理
                            console.debug("[DEBUG]Second card.");
                            let firstCard = gameInfo.cards[gameInfo.cardTmp];
                            let secondCard = gameInfo.cards[data.cardPos];
                            // 2つのカードが一致するかどうか
                            if(firstCard === secondCard){
                                socket._score += 100;
                                // カード情報を削除
                                gameInfo.cards[gameInfo.cardTmp] = gameInfo.cards[gameInfo.cardTmp] = null;
                                // 同じユーザーがもう一度プレイ
                                io.to(socket.id).emit('turn', {token: gameInfo.token});
                                console.debug("[DEBUG]Card hit!");
                            }else{
                                // トークンを更新
                                gameInfo.token = require('crypto').randomBytes(6).toString('hex');
                                // 他のユーザーの番になる
                                io.to(gameInfo.users[gameInfo.next]).emit('turn', {token: gameInfo.token});
                                console.debug(`[DEBUG]Client(${gameInfo.users[gameInfo.next]})'s turn.`);
                                if(gameInfo.next === (gameInfo.users.length - 1)){
                                    gameInfo.next = 0;
                                }else{
                                    gameInfo.next += 1;
                                }
                            }
                            // 初期化
                            gameInfo.cardTmp = null;
                            redisJsonSet(gameInfo.id, gameInfo);
                            res = {
                                cards: [data.cardPos, gameInfo.cards[data.cardPos]]
                            };
                        }else{
                            // 1枚目の処理
                            console.debug("[DEBUG]First card.");
                            gameInfo.cardTmp = data.cardPos;
                            res = {
                                cards: [data.cardPos, gameInfo.cards[data.cardPos]]
                            };
                        }
                        let isFinished = true;
                        gameInfo.cards.some((v,i) => {
                            if(v !== null){
                                isFinished = false;
                            }
                        });
                        redisJsonSet(gameId, gameInfo);
                        if(isFinished){
                            io.to(gameId).emit('finish', {status: "success", rank: 100, score: socket._score});
                        }else{
                            io.to(gameId).emit('cardRes', res);
                        }
                    }
                }else{
                    console.log("[Redis] Unable to read game data.");
                    io.to(gameId).emit('finish', {'status':'exception'});
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
                        redis.lrange('rooms-waiting',0, -1, (error, waitingGamesList) => {
                            if(!error){
                                waitingGamesList.some((v, i) => {
                                    if (v===socket._gameId) waitingGamesList.splice(i,1);
                                });
                                if(waitingGamesList == null || waitingGamesList == ""){
                                    console.log("[Redis] Delete store 'rooms-waiting'");
                                    redis.del('rooms-waiting');
                                }else{
                                    console.log("[Redis] Update waiting list.");
                                    redis.rpush('rooms-waiting', waitingGamesList);
                                }
                            }
                        });
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