//カードを表示
for (var i = 0; i < 20; i++){
    $("#gameField").append('<li class="card"><img src="images/card.jpg"></li>');
}
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