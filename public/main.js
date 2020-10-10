let playerName = localStorage.getItem('playerName');
let authToken = localStorage.getItem('authToken');
if(playerName == null || playerName === "" || authToken == null || authToken === ""){
    window.location.replace("start");
}
$("#loaderMsg").text("サーバーに接続しています...");
const socket = io({
    transports: ['websocket'],
    query: {
        token: authToken
    }
});
let cards = [];
let isTurn = false;
let counter;
socket.on("connect", () => {
    $("#loaderMsg").text("他のプレイヤーの参加を待っています...時間がかかることがあります。");
    console.log("Connected to game server.");
});
socket.on('start', (data) => {
    for (let i = 0; i < 20; i++){
        $("#gameField").append('<li class="card"><img src="images/card.jpg"></li>');
    }
    $("#loaderMsg").text("ゲームが開始されました...");
    $("#loaderWrap").remove();
    $("body").css('background', '#fff');
    $("#game").css('visibility', 'visible');
    console.log("Game started.");
});
socket.on('finish', (data) => {
    $("#turnDisplay").text("Finished!!");
    clearInterval(counter);
    $("#counter").text("");
    let result;
    if(data.status === 'exception'){
        result = {
            status: "exception"
        };
        alert("他のプレイヤーが退出したか、エラーが起きました。");
    }else{
        result = {
            status: "success",
            score: data.score,
            rank: data.rank
        }
    }
    sessionStorage.setItem('result', JSON.stringify(result));
    location.replace("result");
});
socket.on('cardRes', (data) => {
    console.log("EVENT: cardRes");
    if(data.cards[0] !== null){
        if(data.hit){
            console.log("HIT!");
            $('li.card').eq(data.cards[0]).removeClass('open-flag')
                .addClass('card-finished')
                .html(`<img src="images/opend.jpg">`);
            $('li.card').eq(data.cards[2]).removeClass('open-flag')
                .addClass('card-finished')
                .html(`<img src="images/opend.jpg">`);
        }else{
            $('li.card').eq(data.cards[0]).addClass('open-flag').html(`<img src="images/card${data.cards[1]}.jpg">`);
            // カードの向きを変える
            setTimeout(() => {
                $('li.card').eq(data.cards[0]).html(`<img src="images/card.jpg">`);
            }, 2000);
        }
    }
});
socket.on('turn', () => {
    isTurn = true;
    cards = [];
    console.log("EVENT: turn");
    clearInterval(counter);
    $("#turnDisplay").html("<b>あなたの番です。</b>");
    if(true){
        let count = 15;
        const expire = new Date(new Date().getTime() + count*1000);
        counter = setInterval(() => {
            count--;
            $('#counter').text(`制限時間${count}秒`);
            if(new Date().getTime() >= expire.getTime()){
                clearInterval(counter);
                $("#turnDisplay").text("他の人の番です。");
                $("#counter").text("");
            }
        }, 1000);
    }
    $('li.card').on('click', function(){
        const index = $('li.card').index(this);
        if(isTurn){
            if(cards.length < 3 && cards.indexOf(index) === -1){
                console.log("NOTICE: card clicked", cards);
                socket.emit('cardOpen', {cardPos: index});
                if(cards.length === 2){
                    clearInterval(counter);
                    $('li.card').off();
                    $("#counter").text("");
                    $("#turnDisplay").text("他の人の番です。");
                    isTurn = false;
                    cards = [];
                }else{
                    cards.push(index);
                }
            }
        }
    });
});