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
function processOuboxes() {
    seq()
    .seq(function() { platform.getUsers(this); })
    .parMap(function(user) { 
        var callback = this;
        platform.listEmails(user, 'outbox', function(err, emails) { callback(err, {user: user, emails: emails}); }); 
    })
    .unflatten()
    .seqMap(function(userData) {
        var callback = this;
        if(!userData.emails) {
            callback(null);
        }
        else {
            callback(null, userData.emails.map(function(email) { return { user: userData.user, email: email }; }));
        }
    })
    .unflatten()
    .seqMap(function(emailData) {
        var finishedCallback = this;
        seq()
        .seq(function() { platform.openEmail(emailData.email, emailData.user, this.into('stream')); })
        .seq(function(stream, metadata) { this.into('metadata')(null, metadata); })
        .seq(function(metadata) { smtp.connectMx(metadata.to.split('@')[1], this); })
        .seq(function(socket) { smtp.connect({stream : socket}, this.into('mail')); })
        .seq(function() { this.vars.mail.on('greeting', this); })
        .seq(function() { this.vars.mail.helo(config.domains[0], this.into('helo')); })
        .seq(function() { this.vars.mail.from(this.vars.metadata.from, this.into('from')); })
        .seq(function() { this.vars.mail.to(this.vars.metadata.to, this.into('to')); })
        .seq(function() { this.vars.mail.data(this.into('data')); })
        .seq(function() { this.vars.mail.message(this.vars.stream, this.into('message')); })
        .seq(function() { this.vars.mail.quit(this.into('quit')); })
        .seq(function () {
            if(this.vars['data'] == 354 && this.vars['message'] == 250) {
                finishedCallback(null);
                logger.verbose('Mail sent to ' + to);
            }
            else {
                finishedCallback("Error sending mail");
                logger.info('Failed to send mail ' + from + ' -> ' + to);
            }
        });
    })
    .seq(function(){ setTimeout(processOutboxes, 1000); });
}

processOutboxes();
