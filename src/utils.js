var nodemailer = require('nodemailer');
var nconf = require('nconf');
var crypto = require('crypto');
var path = require("path");
var cluster = require("cluster");

module.exports.sendEmail = function(mailData) {
  var smtpTransport = nodemailer.createTransport("SMTP",{
    service: nconf.get('SMTP_SERVICE'),
    auth: {
      user: nconf.get('SMTP_USER'),
      pass: nconf.get('SMTP_PASS')
    }
  });
  smtpTransport.sendMail(mailData, function(error, response){
      var logging = require('./logging');
    if(error) logging.error(error);
    else logging.info("Message sent: " + response.message);
    smtpTransport.close(); // shut down the connection pool, no more messages
  });
}

// Encryption using http://dailyjs.com/2010/12/06/node-tutorial-5/
// Note: would use [password-hash](https://github.com/davidwood/node-password-hash), but we need to run
// model.query().equals(), so it's a PITA to work in their verify() function

module.exports.encryptPassword = function(password, salt) {
  return crypto.createHmac('sha1', salt).update(password).digest('hex');
}

module.exports.makeSalt = function() {
  var len = 10;
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').substring(0, len);
}

/**
 * Load nconf and define default configuration values if config.json or ENV vars are not found
 */
module.exports.setupConfig = function(){
  nconf.argv()
    .env()
    //.file('defaults', path.join(path.resolve(__dirname, '../config.json.example')))
    .file('user', path.join(path.resolve(__dirname, '../config.json')));

  if (nconf.get('NODE_ENV') === "development")
    Error.stackTraceLimit = Infinity;
  if (nconf.get('NODE_ENV') === 'production')
    require('newrelic');
};

module.exports.crashWorker = function(server,mongoose) {
  return function(err, req, res, next) {
    if (!cluster.isMaster) {
      // make sure we close down within 30 seconds
      var killtimer = setTimeout(function() {
          process.exit(1);
      }, 30000);
      // But don't keep the process open just for that!
      killtimer.unref();
      // stop taking new requests.
      server.close();
      mongoose.connection.close();
      cluster.worker.disconnect();
    }
    next(err);
  };
}


module.exports.errorHandler = function(err, req, res, next) {
  // when we hit an error, send it to admin as an email. If no ADMIN_EMAIL is present, just send it to yourself (SMTP_USER)
  var stack = (err.stack ? err.stack : err.message ? err.message : err) +
    "\n ----------------------------\n" +
    "\n\noriginalUrl: " + req.originalUrl +
    "\n\nauth: " + req.headers['x-api-user'] + ' | ' + req.headers['x-api-key'] +
    "\n\nheaders: " + JSON.stringify(req.headers) +
    "\n\nbody: " + JSON.stringify(req.body) +
    (res.locals.ops ? "\n\ncompleted ops: " + JSON.stringify(res.locals.ops) : "");
  var logging = require('./logging');
  logging.error(stack);
  var message = err.message ? err.message : err;
  message =  (message.length < 200) ? message : message.substring(0,100) + message.substring(message.length-100,message.length);
  res.json(500,{err:message}); //res.end(err.message);
}
