var child = require('child_process');
var path = require('path-extra');
var fs = require('fs');
var seq = require('seq');

module.exports.auth = function(user, password, cb) {
    //NOTE!!!! NEED TO ESCAPE THESE SO THEY CAN'T DO ANYTHING NEFARIOUS!!!
    child.exec(__dirname + '/login.sh "' + cliEncode(user) + '" "' + cliEncode(password) + '"', function (error, stdout, stderr) {
        cb(null, error === null);
    });
}

function cliEncode(val) {
    return val.replace(/\;|\||\&/g, "");
}

function getUserId(user, type, cb) {
    var idCmd = child.spawn('id', [cliEncode(type), cliEncode(user)]);
    var idString = '';

    idCmd.stdout.on('data', function(data) {
        idString += data;
    });

    idCmd.on('close', function() {
        var id = parseInt(idString);
        cb(id);
    });
}

module.exports.checkUser = function(user, cb) {
    getUserId(user, '-u', function(id) {
        cb(null, id >= 0);
    });
}

module.exports.writeMaildir = function(user, headers, cb) {
    //launch the command as the user...
    var awk = child.spawn(__dirname + '/newmail.sh', [ cliEncode(user) ]);
    var path = '';
        
    awk.stdout.on('data', function(data) {
        path += data.toString().replace(/^\s+|\s+$/g, "");
    });
    awk.stderr.on('data', function(data) {
        //console.log('awkerr: ', data.toString());
    });

    awk.on('close', function() {
        //open the file for writing...
        var outstream = fs.createWriteStream(path, { flags:'a' });
        var headerStream = null;
        if(headers)
        {
            headerStream = fs.createWriteStream(path + ".hdr", { flags: 'a'});
        }
        else {
            fs.unlink(path + ".hdr");
        }

        cb(outstream, path, headerStream);
    });
}

module.exports.readyMaildir = function(user, path, domain, cb) {
    var ready = child.spawn(__dirname + '/readymail.sh', [ cliEncode(user), cliEncode(path), cliEncode(domain), 'new' ]);
    var path = '';
        
    ready.on('close', function(data) {
        cb();
    });
}

module.exports.readyOutbox = function(user, path, domain, cb) {
    var ready = child.spawn(__dirname + '/readymail.sh', [ cliEncode(user), cliEncode(path), cliEncode(domain), 'out' ]);
    var path = '';

    ready.on('close', function(data) {
        cb();
    });
}

module.exports.getUsers = function(cb) {
    //launch the command as the user...
    var awk = child.spawn(__dirname + '/getAllUsers.sh');
    var path = '';
        
    awk.stdout.on('data', function(data) {
        path += data.toString();
    });
    awk.stderr.on('data', function(data) {
        //console.log('awkerr: ', data.toString());
    });

    awk.on('close', function() {
        path = path.replace(/^\s+|\s+$/g, "");
        var users = path.split(/\r?\n/);
        cb(users);
    });
}

module.exports.getNextOut = function(user, cb, doneCb) {
    //launch the command as the user...
    var awk = child.spawn(__dirname + '/getoutmail.sh', [ cliEncode(user) ]);
    var path = '';
        
    awk.stdout.on('data', function(data) {
        path += data.toString();
    });
    awk.stderr.on('data', function(data) {
        //console.log('awkerr: ', data.toString());
    });

    awk.on('close', function() {
        path = path.replace(/^\s+|\s+$/g, "");
        var emails = path.split(/\r?\n/);
        seq(emails)
            .seqEach(function(email) {
                var self = this;
                var files = email.split(';');
                cb(files[0], files[1], function(err) {
                    if(err === null) {
                        child.spawn('rm', [files[0]], 'inherit');
                        child.spawn('rm', [files[1]], 'inherit');
                    }
                    self(null);
                });
            }).seq(doneCb);
    });
}
