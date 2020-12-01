import { Request, Response, Fastly, Headers } from '@fastly/as-compute'
import { JSON } from 'assemblyscript-json'
import { Console } from 'as-wasi'
// The name of a backend server associated with this service.
//
// This should be changed to match the name of your own backend. See the the
// `Hosts` section of the Fastly Wasm service UI for more information.
const BACKEND_SPACEX = 'SpaceX'

/// The name of a second backend associated with this service.
const BACKEND_N2YO = 'n2yo'

const n2yoApiKey = 'YBLNQJ-JUG3KB-XS5BRT-1JX2'
const spaceXUri = 'https://api.spacex.land/graphql/'
const n2yoUri = 'https://api.n2yo.com/rest/v1/satellite/'
// The entry point for your application.
//
// Use this function to define your main request handling logic. It could be
// used to route based on the request properties (such as method or path), send
// the request to a backend, make completely new requests, and/or generate
// synthetic responses.
function main(req: Request): Response {
  // Make any desired changes to the client request.
  Console.log('Request URL: ' + req.url() + '\n')
  //  req.headers().set('Host', 'example.com')

  //throw new Error('THIS IS AN ERROR')

  // We can filter requests that have unexpected methods.
  const VALID_METHODS = ['HEAD', 'GET', 'POST']
  if (!VALID_METHODS.includes(req.method())) {
    Console.log('Invalid method "' + req.method() + '"' + '\n')
    return new Response(String.UTF8.encode('This method is not allowed'), {
      status: 405,
    })
  }
  Console.log('Valid method (' + req.method() + ')' + '\n')
  Console.log('initialized plotter' + '\n')
  //  return new Response(String.UTF8.encode(plotter.noradIds('Thaicom 6')), {
  //    status: 200,
  //  })

  let urlParts = req.url().split('//').pop().split('/')
  let host = urlParts.shift()
  let path = '/' + urlParts.join('/')
  Console.log('URL parts: ' + urlParts.toString() + '\n')
  Console.log('Host: ' + host + '\n')
  Console.log('Path: ' + path + '\n')
  let text: string
  let status: u16 = 200
  if (path == '/n2yo') {
    Console.log('Requesting N2YO test\n')
    text = testRequestN2YO()
    Console.log('N2YO request successful')
  } else if (path == '/spacex') {
    Console.log('Requesting SpaceX test\n')
    text = testRequestSpaceX()
    Console.log('SpaceX request successful')
  } else {
    text = 'Unrecognized request. Path "' + path + '"'
    status = 400
  }
  Console.log('Text: ' + text)
  Console.log('Text again: ' + text)
  return new Response(String.UTF8.encode(text), {
    status,
  })
  /*
  //return new Response(String.UTF8.encode(plotter.noradIds('Thaicom 6')), {
  // If request is a `GET` to the `/` path, send a default response.
  if (method == 'GET' && path == '/') {
    return new Response(String.UTF8.encode(plotter.noradIds('Thaicom 6')), {
      status: 200,
    })
  }

  // If request is a `GET` to the `/backend` path, send to a named backend.
  if (method == 'GET' && path == '/backend') {
    // Request handling logic could go here...
    // E.g., send the request to an origin backend and then cache the
    // response for one minute.
    let cacheOverride = new Fastly.CacheOverride()
    cacheOverride.setTTL(60)
    return Fastly.fetch(req, {
      backend: BACKEND_SPACEX,
      cacheOverride,
    }).wait()
  }

  // If request is a `GET` to a path starting with `/other/`.
  if (method == 'GET' && path.startsWith('/other/')) {
    // Send request to a different backend and don't cache response.
    let cacheOverride = new Fastly.CacheOverride()
    cacheOverride.setPass()
    return Fastly.fetch(req, {
      backend: BACKEND_N2YO,
      cacheOverride,
    }).wait()
  }

  // Catch all other requests and return a 404.
  return new Response(
    String.UTF8.encode('The page you requested could not be found'),
    {
      status: 200,
    }
  )
  */
}

// Get the request from the client.
let req = Fastly.getClientRequest()

// Pass the request to the main request handler function.
let resp = main(req)

// Send the response back to the client.
Fastly.respondWith(resp)

function testRequestSpaceX(): string {
  Console.log('test request for spacex\n')
  const query =
    '{"query":"{ payload(id: \\"Thaicom 6\\") { norad_id } }","variables":{}}'
  Console.log('query: ' + query + '\n')
  const headers = new Headers()
  const method = 'POST'
  const url = spaceXUri
  const body = query
  headers.set('Content-Type', 'application/json')
  Console.log('Set "Content-Type" of "application/json"\n')
  const request = new Request(spaceXUri, {
    method,
    headers,
    body: String.UTF8.encode(query),
  })
  Console.log('Created request: ' + body + '\n')
  Console.log('Request text again: ' + body + '\n')
  Console.log('Request method: ' + method + '\n')
  Console.log('Request URL: ' + url + '\n')
  Console.log('Sending request to backend "' + BACKEND_SPACEX + '"\n')
  let response = Fastly.fetch(request, {
    backend: BACKEND_SPACEX,
    cacheOverride: null,
  }).wait()
  Console.log('Response complete\n')
  const status = response.status()
  const statusText = response.statusText()
  const response_text = response.text()
  if (status != 200) {
    Console.log(
      'Response failed. Remote responded with: ' +
        '"' +
        status.toString() +
        ' ' +
        statusText +
        '"\n'
    )
    Console.log('Response text: ' + response_text)
    throw new Error(
      'Remote responded with: ' +
        '"' +
        status.toString() +
        ' ' +
        statusText +
        '"'
    )
  }
  Console.log('Response text: ' + response_text)
  return response_text
}

function testRequestN2YO(): string {
  Console.log('test request for n2yo\n')
  const uri = n2yoUri + '/tle/39500?apiKey=' + n2yoApiKey
  const method = 'GET'
  const headers = new Headers()
  const request = new Request(uri, { method, headers })
  Console.log('Created request\n')
  Console.log('Request method: ' + method + '\n')
  Console.log('Request URL: ' + uri + '\n')
  Console.log('Sending request to backend "' + BACKEND_N2YO + '"\n')
  const response = Fastly.fetch(request, {
    backend: BACKEND_N2YO,
    cacheOverride: null,
  })
  Console.log('Response pending\n')
  return response.wait().text()
}

class SpaceXPlotter {
  readonly n2yoApiKey: string
  constructor(n2yoApiKey: string) {
    this.n2yoApiKey = n2yoApiKey
  }

  public noradIds(payloadId: string): string {
    const res = this.spacexRequest(
      '{ payload(id: "' + payloadId + '") { norad_id } }'
    )
    return res.text()
  }

  private spacexRequest(query: string): Response {
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    const request = new Request(spaceXUri, {
      method: 'POST',
      headers,
      body: String.UTF8.encode(
        '{"query":{' + JSON.from(query).toString() + '}'
      ),
    })
    const response = Fastly.fetch(request, {
      backend: BACKEND_SPACEX,
      cacheOverride: null,
    }).wait()
    return response
  }
}
