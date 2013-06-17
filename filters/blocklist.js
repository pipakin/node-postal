var dns = require('dns'),
    db = require('./list.json'),
    seq = require('seq');


function checkRbls(context, ip, callback) {
    var flipped = ip.split('.').reverse().join('.');
    if(context.filterValues.ipPassed) {
        callback(null, true);
        return;
    }

    seq(db)
        .parMap(function(rbl) {
            var cb = this;
            dns.resolve4(flipped + '.' + rbl.dns, function (err, domain) {
                if(err) {
                    context.logger.info('passed ' + rbl.name);
                    cb(null,false);
                }
                else {
                    context.logger.info('failed ' + rbl.name);
                    cb(null,true);
                }
            });
        })
        .unflatten()
        .seq(function(results) {
            if(results.indexOf(true) > -1)
            {
                callback(null, 100, 'ip is on block list');
            }
            else {
                context.filterValues.ipPassed = true;
                callback(null, 0);
            }
        });
}

module.exports = function(req, filePath, callback) {
    checkRbls(req, req.remoteAddress, callback);
}
