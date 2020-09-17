const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
//環境変数をロード
require('dotenv').config();
//リクエストボディのパーサー
const bodyParser = require('body-parser');
// compression
const compression = require('compression');

const apiRouter = require('./routes/api');

const app = express();

// gzip compression
app.use(compression());

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// http headers
app.use(function (req, res, next) {
  res.removeHeader('X-Powered-By');
  res.header('Cache-Control', ['public', 'max-age=86400'].join(','));
  next();
});

app.use(function (req, res, next) {
  let sslUrl;
  if (process.env.NODE_ENV === 'production' && req.hostname.endsWith('herokuapp.com')) {
    sslUrl = ['https://oceanblue.toinfes.jp', req.url].join('');
    return res.redirect(sslUrl);
  }
  if(process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    sslUrl = ['https://', req.hostname, req.url].join('');
    return res.redirect(sslUrl);
  }
  return next();
});
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use('/api/', apiRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404, 'お探しのページは見つかりませんでした。'));
});

// error handler
app.use(function(err, req, res) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
