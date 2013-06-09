module.exports = {
    platform: 'unix',
    usermap: 'simple',
    tlsenabled: true,
    tlsonly: true,
    privateKeyFile: '/path/to/privatekey.pem',
    certificateFile: '/path/to/certificate.pem',
    domains: ['yourdomain.com', 'localhost', '127.0.0.1'],
};
