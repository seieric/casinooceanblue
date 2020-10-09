const express = require('express');
const router = express.Router();
const path = require('path');

router.get('/ranking', (req,res) => {
    res.sendFile(path.join(__dirname, '../public/ranking.html'));
});
router.get('/game', (req, res) => {
    if(process.env.GAME_ENABLED){
        res.sendFile(path.join(__dirname, '../public/game.html'));
    }else{
        res.status(503);
        res.send('この機能は現在無効にされています.')
    }
});
router.get('/start', (req, res) => {
    if(process.env.GAME_ENABLED){
        res.sendFile(path.join(__dirname, '../public/start.html'));
    }else{
        res.status(503);
        res.send('この機能は現在無効にされています.')
    }
});
router.get('/result', (req, res) => {
    if(process.env.GAME_ENABLED){
        res.sendFile(path.join(__dirname, '../public/result.html'));
    }else{
        res.send('この機能は現在無効にされています.')
    }
});
module.exports = router;