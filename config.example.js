module.exports = {
    platform: 'unix',
    usermap: 'simple',
    tlsenabled: true,
    tlsonly: true,
    privateKeyFile: '/path/to/privatekey.pem',
    certificateFile: '/path/to/certificate.pem',
    blockEmailScore: 99,
    markAsSpamScore: 60,
    domains: ['yourdomain.com', 'localhost', '127.0.0.1'],
};
