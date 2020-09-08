//カードを表示
for (var i = 0; i < 20; i++){
    $("#gameField").append('<li class="card"><img class="card-image" src="images/card.jpg"></li>');
}
//自分の番判定用フラグ
let isTurn = false;
//選択されたカード情報
let cards = {first: "", second: ""};
//セッションからトークンとプレイヤー名を取得
let playerName = localStorage.getItem('playerName');
let authToken = localStorage.getItem('authToken');
if(playerName == null || playerName === "" || authToken == null || authToken === ""){
    window.location.href="start.html";
}
console.log("Credentials have been loaded.");
const socket = io({
    query: {
        token: authToken
    }
});
socket.on("connect", () => {
    console.log("Connected to game server.");
});
socket.on("start", (data) => {
    console.log("Game has benn started.");
    $("messageBox").innerText("ゲームが始まりました。");
})
socket.on("turn", (data) => {
   console.log("Now your turn.");
   console.log("Authentication: token is", data.token);
   $("#turnDisplay").innerText("あなたの番です。");
   isTurn = true;
   setInterval(() => {
       isTurn = false;
       io.emit("cardOpen", cards);
   }, 100000);
});
socket.on('finish', (data) => {
    if(data.status === "exception"){
        console.log("Game finished with exception. Sorry.");
        let result = {
            status: "exception"
        };
        localStorage.setItem(result);
    }else{
        console.log("Game finished.");
        let result = {
            status: "success",
            score: data.score || null,
            ranking: data.ranking || null
        };
        localStorage.setItem(result);
    }
    location.replace("result.html");
});
$("#gameField li").on('click',() => {
    let index = $("#gameField li").index(this);
    console.log("Index is " + index);
});
$("div").on('click', () => {
   let index = $("div ").index(this);
   console.log(index);
});