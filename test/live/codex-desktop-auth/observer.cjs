const net = require('node:net'),
  fs = require('node:fs')
let next = 0
net
  .createServer((client) => {
    const id = ++next,
      upstream = net.connect(45100, '127.0.0.1')
    let request = '',
      response = '',
      requested = false,
      responded = false
    const record = (value) =>
      fs.appendFileSync(
        'C:/ThreadlightGuest/handshakes.jsonl',
        JSON.stringify({ id, ...value }) + '\n',
      )
    client.on('data', (data) => {
      if (requested) return
      request += data.toString('latin1')
      if (request.includes('\r\n\r\n')) {
        requested = true
        record({ direction: 'request', authorizationPresent: /\r\nauthorization:/i.test(request) })
        request = ''
      }
    })
    upstream.on('data', (data) => {
      if (responded) return
      response += data.toString('latin1')
      if (response.includes('\r\n')) {
        responded = true
        record({ direction: 'response', status: response.split('\r\n')[0] })
        response = ''
      }
    })
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
    client.pipe(upstream)
    upstream.pipe(client)
  })
  .listen(45101, '127.0.0.1')
