var smtp = require('smtp-protocol');
var fs = require("fs");
var seq = require('seq');

var config = require('./config');
var platform = require('./platform-' + config.platform + '.js');
var usermap = require('./usermap-' + config.usermap + '.js');
var logger = require('./logger.js');

var privateKey = config.tlsenabled ? fs.readFileSync(config.privateKeyFile).toString() : '';
var certificate = config.tlsenabled ? fs.readFileSync(config.certificateFile).toString() : '';

var logger = logger.createLogger("node-postal SMTP", { debug: true, verbose: true} );

logger.info("starting...");

function filterValidUser(from, to, cb) {
    if(from === undefined || to === undefined) { 
        cb(null, true);
        return;
    }

    seq([from,to])
        .parEach(function(addr) {
            var domain = addr.split('@')[1];
            var user = usermap.getUser(addr.split('@')[0]);
            
            if(config.domains.indexOf(domain)) {
                platform.checkUser(user, this);
            }
            else {
                this(null, false);
            }
        }).seq(function(results) {
            if(results.indexOf(false) > -1) {
                logger.info('invalid user/relay ' + from + ' -> ' + to);
                cb(null, false);
                return;
            }
            cb(null, true);
        });;

}

function processAckFilters(cmd, req, ack, filters, cbPassed, cbFailed)
{
    var localcmd = cmd;
    var localreq = req;
    var localack = ack;

    seq([filters])
        .flatten()
        .seqEach(function(filter) {
            filter(localcmd, localreq, this);
        })
        .unflatten()
        .seq(function(results) {
            if(results.indexOf(false) > -1) {
                cbFailed(cmd, ack);
            }
            else {
                cbPassed(cmd, ack);
            }
        });
}

function makeAckCallback(accept, code, msg) {
    if(accept) {
        return function(cmd, ack) { ack.accept(code, msg) };
    }
    else {
        return function(cmd, ack) { ack.reject(code, msg) };
    }
}

function makeServer(req) {
    req.on('greeting', function(cmd, ack)
    {
        ack.accept(250, 'greetings from ' + config.domains[0] + '!\nSTARTTLS\nAUTH LOGIN PLAIN');
    });
    req.on('received', function(ack)
    {
        if(req.receiving) {
            ack.accept(250, 'Queued mail for delivery');
            req.receiving = false;
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
        var filters = [
            function(cmd, req, cb) {
                filterValidUser(cmd, req.from, cb);
            }];

        processAckFilters(to, req, ack, filters, makeAckCallback(true, 250, 'Recipient OK'), makeAckCallback(false));

    });

    req.on('from', function(from, ack) {
        var filters = [
            function(cmd, req, cb) {
                filterValidUser(req.to, cmd, cb);
            }];

        processAckFilters(from, req, ack, filters, makeAckCallback(true, 250, 'Sender OK'), makeAckCallback(false));
    });
    
    req.on('message', function (stream, ack) {
        logger.verbose('from: ' + req.from);
        req.receiving = true;
        var bits = req.to.split('@');
        var user = usermap.getUser(bits[0]);
        var domain = bits[1];

        if(config.domains.indexOf(domain) > -1) {
            platform.writeMaildir(user, false, function(outstream, path) {
                stream.pipe(outstream);
                stream.on('end', function() { 
                    //move file to /new...
                    platform.readyMaildir(user, path, config.domains[0], function() { });
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
                platform.writeMaildir(user, true, function(outstream, path, headers) {
                    stream.pipe(outstream);
                    headers.end(req.to + '\0' + req.from);
                    stream.on('end', function() { 
                        platform.readyOutbox(user, path, config.domains[0], function() { logger.info('message written to outbox.'); });
                    });
                });
            }
            else {
                ack.reject(500, 'Must login first.');
            }
        }
        ack.accept(354, 'Start mail input; end with <CRLF>.<CRLF>');
    });
    req.on('starttls', function (cmd, ack) {
        ack.accept(220, "Ready to start TLS");
    });
}

smtp.createServer(makeServer, config.domains[0], {key: privateKey, cert: certificate}).listen(25);
smtp.createServer(makeServer, config.domains[0], {key: privateKey, cert: certificate}).listen(587);

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

processOutboxes();
