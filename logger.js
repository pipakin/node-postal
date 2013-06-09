exports.createLogger = function (prefix, options)
{
    return new logger(prefix, options);
}

function logger(prefix, options)
{
    this.options = options || {};
    this.prefix = prefix + ' '; 
}

logger.prototype.debug = function(msg) {
    if(this.options.debug)
    {
        console.log(this.prefix + msg);
    }
}

logger.prototype.info = function(msg) {
    console.log(this.prefix + msg);
}


logger.prototype.verbose = function(msg) {
    if(this.options.verbose)
    {
        console.log(this.prefix + msg);
    }
}

logger.prototype.sub = function(subprefix)
{
    return new logger(this.prefix + subprefix, this.options);
}
