var smtp = require('smtp-protocol');
var fs = require("fs");
var seq = require('seq');
var dns = require('dns');
var path = require('path');
var es = require('event-stream');
var extend = require('node.extend');

var config = require('./config.js');
var usermap = require('./usermap-' + config.usermap + '.js');
var logger = require('./logger.js').createLogger("node-postal SMTP", { debug: true, verbose: true} );
var platform = require('./platform/' + config.platform + '.js').createPlatform(config, logger);
var privateKey = config.tlsenabled ? fs.readFileSync(config.privateKeyFile).toString() : '';
var certificate = config.tlsenabled ? fs.readFileSync(config.certificateFile).toString() : '';


logger.info("starting...");
    
var filters = [];
//get the filter files...
fs.readdir(path.join(__dirname, 'filters'), function(err, files) {
    for(var i in files) {
        if(files[i].match('.js$')=='.js') {
            filters.push(require('./filters/' + path.basename(files[i])));
        }
    }
});

function filterNew(req, path, callback, options) {
    var localreq = extend({}, req, options || {});
    localreq = extend(localreq, { config: config, platform: platform, usermap: usermap, logger: logger });
    localreq.filterValues = req.filterValues || {};
    var localpath = path;

    seq(filters)
        .flatten()
        .seqMap(function(filter) {
            var cb = this;
            filter(localreq, localpath, function(err, score, reason) {
                cb(err, {score: score, reason: reason});
            });
        })
        .reduce(function(finalResult, result) {
            finalResult.score += result.score;
            if(finalResult.reason && result.score > 0) {
                finalResult.reason += '\n' + result.reason;
            }
            else if(result.score > 0) {
                finalResult.reason = result.reason;
            }

            return finalResult;
        }, { score: 0, reason: '' })
        .seq(function(result) {
            req.filterValues = localreq.filterValues;
            callback(null, result.score, result.reason);
        });
}

function logPipe(stream) {
    var log = es.map(function (buf, map) {
        var data = buf.toString();
        console.info(data);
        map(null, data);
    });

//    stream.readable = true;
//    stream.writeable = true;
    stream.pipe(log);
    return log;
}

function makeServer(req) {
    req.on('greeting', function(cmd, ack)
    {
        filterNew(req, null, function(err, score, reason) {
            if(score > config.blockEmailScore) {
                ack.reject(500, 'spam detection triggered:\n' + reason);
            }
            else {
                ack.accept(250, 'greetings from ' + config.domains[0] + '!\nSTARTTLS\nAUTH LOGIN PLAIN');
            }
        });
    });
    req.on('received', function(ack)
    {
        if(req.receiving) {
            ack.accept(250, 'Queued mail for delivery');
            req.receiving = false;
        }else {
            ack.ignore();
        }
    });

    req.on('auth', function (cmd, ack) {
        platform.auth(cmd.user, cmd.password, function(err, passed) {
            if(passed) {
                ack.accept(250, 'Go ahead');
            }
            else {
                ack.reject(535, 'authentication failed.');
            }
        });
    });

    req.on('to', function (to, ack) {
        filterNew(req, null, function(err, score, reason) {
            if(score > config.blockEmailScore) {
                ack.reject(500, 'spam filtering rejected:\n' + reason);
            }
            else {
                ack.accept(250, 'Recipient OK');
            }
        }, {to: to});

    });

    req.on('from', function(from, ack) {
        filterNew(req, null, function(err, score, reason) {
            if(score > config.blockEmailScore) {
                ack.reject(500, 'spam filtering rejected:\n' + reason);
            }
            else {
                ack.accept(250, 'Recipient OK');
            }
        });
    });
    
    req.on('message', function (stream, ack, completeAck) {
        logger.verbose('from: ' + req.from);
        req.receiving = false;
        var bits = req.to.split('@');
        var user = usermap.getUser(bits[0]);
        var domain = bits[1];

        if(config.domains.indexOf(domain) > -1) {
            platform.createEmail(user, function(err, outstream, id) {
                //stream.readable = true;
                ack.accept(354, 'Start mail input; end with <CRLF>.<CRLF>');
                stream.pipe(outstream);
                logger.info('streaming... ' + id);
                var ended = false;
                outstream.on('finish', function() {
                    logger.info('end: ' + stream.bytesWritten);
                    if(ended)return;
                    ended = true;

                    filterNew(req, id, function(err, totalScore, mainReason) {
                        logger.info('Score: ' + totalScore + ' Reason: ' + mainReason);
                        if(totalScore > config.blockEmailScore) {
                            logger.info('detected SPAM: ' + mainReason);
                            seq()
                            .seq(function() { platform.fileEmail(id, user, 'spam', { from: req.from, to: req.to, score: totalScore, reason: mainReason }, this); })
                            .seq(function() { completeAck.reject(500, 'spam detected:' + mainReason); });
                        }
                        else if(totalScore > config.markAsSpamScore) {
                            logger.info('marked potential SPAM: ' + mainReason);
                            seq()
                            .seq(function() { platform.markAsSpam(id, this); })
                            .seq(function() { platform.fileEmail(id, user, 'inbox', this); })
                            .seq(function() { completeAck.accept(250, 'Queued mail for delivery (smells SPAMmy, though)'); });      
                        }
                        else {
                            seq()
                            .seq(function() { platform.fileEmail(id, user, 'inbox', this); })
                            .seq(function() { completeAck.accept(250, 'Queued mail for delivery'); });      
                        }
                    });
                });
            });
        }
        else {
            if(req.user || config.domains.indexOf(req.remoteAddress) > -1)
            {
                bits = req.from.split('@');
                user = usermap.getUser(bits[0]);
                domain = bits[1];

                //connect to the other server and send the message...
                logger.info('outgoing message (valid relay) to ' + req.to + ' from ' + req.remoteAddress + ' user: ' + user);
                platform.createEmail(user, true, function(err, outstream, id) {
                    ack.accept(354, 'Start mail input; end with <CRLF>.<CRLF>');
                    stream.pipe(outstream);
                    stream.on('end', function() {
                        seq()
                        .seq(function() { platform.fileEmail(id, user, 'outbox', this); })
                        .seq(function() { completeAck.accept(250, 'Queued mail for delivery'); });
                    });
                });
            }
            else {
                ack.reject(500, 'Must login first.');
            }
        }
    });

    req.on('starttls', function (cmd, ack) {
        ack.accept(220, "Ready to start TLS");
    });
}

smtp.createServer(makeServer, config.domains[0], {key: privateKey, cert: certificate}).listen(25);
smtp.createServer(makeServer, config.domains[0], {key: privateKey, cert: certificate}).listen(587);
//smtp.createServer(makeServer, config.domains[0], {key: privateKey, cert: certificate}).listen(3025);

//process outgoing mails...
function processOutboxes() {
    platform.getUsers(function(users) {
        seq(users)
        .seqEach(function(user) {
            platform.getNextOut(user, function(msgFile, hdrFile, nextOutCallback) {
                if(!msgFile)
                {
                    nextOutCallback('no file');
                    return;
                }

                logger.info('processing file: ' + msgFile);
                var parts = fs.readFileSync(hdrFile).toString().split('\0');
                var to = parts[0];
                var from = parts[1];
                var domain = to.split('@')[1];

                smtp.connectMx(domain, function(err, socket) {
                    //handle error!!!
                    if(err === null) {
                        smtp.connect({ stream: socket }, function( mail ) {
                            seq()
                                .seq_(function (next) {
                                    mail.on('greeting', function (code, lines) {
                                        next();
                                    });
                                })
                                .seq(function (next) {
                                    mail.helo(config.domains[0], this.into('helo'));
                                })
                                .seq(function () {
                                    mail.from(from, this.into('from'));
                                })
                                .seq(function () {
                                    mail.to(to, this.into('to'));
                                })
                                .seq(function () {
                                    mail.data(this.into('data'))
                                })
                                .seq(function () {
                                    console.dir(this.vars);                                                             
                                    mail.message(fs.createReadStream(msgFile), this.into('message'));
                                })
                                .seq(function () {
                                    mail.quit(this.into('quit'));
                                })
                                .seq(function () {
                                    if(this.vars['data'] == 354 && this.vars['message'] == 250) {
                                        nextOutCallback(null);
                                        logger.info('Mail sent to ' + to);
                                    }
                                    else {
                                        nextOutCallback("Error sending mail");
                                        logger.info('Failed to send mail ' + from + ' -> ' + to);
                                    }
                                })
                            ;
                        });
                    }                    
                });
            }, this);
        })
        .seq(function() { 
            setTimeout(processOutboxes, 1000);
        });
    });
}

//processOutboxes();
