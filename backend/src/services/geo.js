const geoip = require('geoip-lite');

const cache = new Map();
const CACHE_MAX = 1000;
const PRIVATE_IP_RE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.)|^::1$|^fc|^fd|^fe80:/;

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const first = String(forwarded).split(',')[0].trim();
        if (first) return first;
    }
    return req.ip || (req.socket && req.socket.remoteAddress) || null;
}

function resolveCity(ip) {
    if (!ip || PRIVATE_IP_RE.test(ip)) return null;

    if (cache.has(ip)) return cache.get(ip);

    let city = null;
    const lookup = geoip.lookup(ip);
    if (lookup) {
        const parts = [lookup.city, lookup.region, lookup.country].filter(Boolean);
        city = parts.join(', ') || null;
    }

    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(ip, city);
    return city;
}

module.exports = {
    getClientIp,
    resolveCity
};
