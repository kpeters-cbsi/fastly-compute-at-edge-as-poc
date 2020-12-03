import {
  Request,
  Response,
  Fastly,
  Headers,
  RequestInit,
} from '@fastly/as-compute'
import { JSON } from './lib/assemblyscript-json'
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
  const VALID_METHODS = ['GET']
  if (!VALID_METHODS.includes(req.method())) {
    Console.log('Invalid method "' + req.method() + '"' + '\n')
    return new Response(String.UTF8.encode('This method is not allowed'), {
      status: 405,
    })
  }
  Console.log('Valid method (' + req.method() + ')' + '\n')
  //  return new Response(String.UTF8.encode(plotter.noradIds('Thaicom 6')), {
  //    status: 200,
  //  })

  const urlParts = req.url().split('//').pop().split('/')
  let host = urlParts.shift()
  let path = '/' + urlParts.join('/')
  Console.log('URL parts: ' + urlParts.toString() + '\n')
  Console.log('Host: ' + host + '\n')
  Console.log('Path: ' + path + '\n')

  if (urlParts[0] == 'test') {
    Console.log('Responding with test data')
    if (urlParts.length < 2) {
      urlParts.push('')
    }
    const response = handleTest(urlParts[1])
    return response
  } else {
    const payloadId = 'Thaicom 6'
    Console.log('initializing plotter' + '\n')
    const plotter = new SpaceXPlotter(n2yoApiKey)
    Console.log('initialized plotter' + '\n')
    const noradIds = plotter.noradIds(payloadId)
    if (noradIds) {
      Console.log('Got NORAD IDs\n')
      const tles = plotter.tles(noradIds[0])
      if (tles) {
        Console.log('Got TLEs\n')
        return new Response(String.UTF8.encode(tles.join('\n')), {
          status: 200,
        })
      } else {
        Console.log('No TLEs, return NORAD IDs\n')
        return new Response(String.UTF8.encode(noradIds.toString()), {
          status: 200,
        })
      }
    } else {
      const err = plotter.lastError()
      if (!err) {
        return new Response(
          String.UTF8.encode(
            'No NORAD IDs found for payload "' + payloadId + '"'
          ),
          {
            status: 404,
          }
        )
      } else {
        return new Response(String.UTF8.encode(err.toString()), { status: 500 })
      }
    }
  }
}

// Get the request from the client.
let req = Fastly.getClientRequest()

// Pass the request to the main request handler function.
let resp = main(req)

// Send the response back to the client.
Fastly.respondWith(resp)

function handleTest(type: string): Response {
  let text: string
  if (type == 'n2yo') {
    Console.log('Requesting N2YO test\n')
    text = testRequestN2YO()
    Console.log('N2YO request successful')
  } else if (type == '/spacex') {
    Console.log('Requesting SpaceX test\n')
    text = testRequestSpaceX()
    Console.log('SpaceX request successful\n')
  } else {
    return new Response(
      String.UTF8.encode('Unrecognized test: "' + type + '"'),
      { status: 400 }
    )
  }
  Console.log('Text: ' + text)
  const parsed = <JSON.Obj>JSON.parse(text)
  if (parsed.has('tle')) {
    const tle = <string>parsed.get('tle')!.toString()
    Console.log('tle: ' + tle + '\n')
    return new Response(String.UTF8.encode(tle), {
      status: 200,
    })
  } else if (parsed.has('data')) {
    const data = <JSON.Obj>parsed.get('data')
    const payload = <JSON.Obj>data.get('payload')
    if (payload) {
      if (payload.has('norad_id')) {
        const norad_ids = <JSON.Arr>payload.get('norad_id')
        Console.log('norad ID 0: ' + norad_ids._arr[0].toString() + '\n')
        Console.log(
          'norad ID 0 + 1: ' +
            (Number.parseInt(norad_ids._arr[0].toString()) + 1).toString() +
            '\n'
        )
        if (Array.isArray(norad_ids)) {
          Console.log(`norad ids is an array\n`)
        } else {
          Console.log(`norad ids is not an array\n`)
        }
        return new Response(String.UTF8.encode(norad_ids.toString()), {
          status: 200,
        })
      }
    }
  }
  return new Response(String.UTF8.encode(text), {
    status: 200,
  })
}

function doRequest(
  method: string,
  uri: string,
  backend: string,
  headers: Headers = new Headers(),
  body: string = ''
): Response {
  const init: RequestInit = {
    method: method,
    headers: headers || new Headers(),
    body: String.UTF8.encode(body),
  }
  Console.log('Created request\n')
  Console.log('Request method: ' + method + '\n')
  Console.log('Request URL: ' + uri + '\n')
  Console.log('Sending request to backend "' + backend + '"\n')
  const request = new Request(uri, init)
  return Fastly.fetch(request, {
    backend: backend,
    cacheOverride: null,
  }).wait()
}

function testRequestN2YO(): string {
  Console.log('test request for n2yo\n')
  const uri = n2yoUri + '/tle/39500?apiKey=' + n2yoApiKey

  const response = doRequest('GET', uri, BACKEND_N2YO)
  return response.text()
}

function testRequestSpaceX(): string {
  Console.log('test request for spacex\n')
  const body =
    '{"query":"{ payload(id: \\"Thaicom 6\\") { norad_id } }","variables":{}}'
  Console.log('query: ' + body + '\n')
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  const response = doRequest('POST', spaceXUri, BACKEND_SPACEX, headers, body)
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
    throw new _Error(
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

class SpaceXPlotter {
  readonly n2yoApiKey: string
  private _lastError: _Error | null
  constructor(n2yoApiKey: string) {
    this.n2yoApiKey = n2yoApiKey
  }

  /**
   * Return the most recent error, if any, encountered in the last method call.
   *
   * If this method returns null, that indicates that no error was encountered.
   */
  public lastError(): _Error | null {
    return this._lastError
  }

  /**
   * Return the NORAD ID(s) for the given SpaceX payload
   *
   * @param payloadId SpaceX payload ID
   * @returns Array of NORAD IDs. Null can indicate both 'no IDs found' and an error; check @see lastError() to see what's what
   */
  public noradIds(payloadId: string): i64[] | null {
    Console.log('Request NORAD IDs for payload "' + payloadId + '"\n')
    this._lastError = null
    const res = this.spacexRequest(
      '{ payload(id: "' + payloadId + '") { norad_id } }'
    )
    if (!res) {
      const err = this.lastError()
      if (err) {
        Console.log('ERROR: ' + err.toString() + '\n')
      } else {
        Console.log('No NORAD IDs found\n')
      }
      return null
    }
    const data = res.get('data')
    if (!data) {
      Console.log('ERROR: SpaceX response missing "data" field\n')
      this._lastError = new _Error('"data" field missing in SpaceX response')
      return null
    }
    const payload = <JSON.Obj>(<JSON.Obj>data).get('payload')
    if (payload) {
      if (payload.has('norad_id')) {
        const norad_ids = <JSON.Arr>payload.get('norad_id')
        const noradIds: i64[] = norad_ids._arr.map<i64>(
          (val: JSON.Value) => (<JSON.Num>val)._num
        )
        Console.log(noradIds.length.toString() + ' NORAD IDs found: ' + noradIds.toString() + '\n')
        return noradIds
      } 
      Console.log('No NORAD IDs found\n')
    }
    Console.log('WARNING: No "payload" in SpaceX response')
    return null
  }

  /**
   * Return the two line orbital elements (TLE) for the given NORAD ID
   *
   * @param noradId
   * @returns the TLEs as an array of strings.
   */
  public tles(noradId: i64): string[] | null {
    Console.log('Request TLEs for NORAD ID ' + noradId.toString() + '\n')
    const path = 'tle/' + noradId.toString()
    const res = this.n2yoRequest(path)
    if (!res) {
      const err = this.lastError()
      if (err) {
        Console.log('ERROR: ' + err.toString())
      } else {
        Console.log('No TLEs found')
      }
      return null
    }
    const tle = <JSON.Str>res.get('tle')
    if (!tle) {
      Console.log('ERROR: N2YO response missing "tle" field\n')
      this._lastError = new _Error('"tle" field missing in N2YO response')
      return null
    }
    const tleStr = tle._str // _str gives the unencoded string
    Console.log('Got TLEs: "' + tleStr + '"\n')
    const arr = tleStr.split('\r\n')
    for (let i = 0; i < arr.length; i++) {
      Console.log('TLE ' + i.toString() + ': "' + arr[i] + '"\n')
    }
    return arr
  }

  private n2yoRequest(path: string): JSON.Obj | null {
    Console.log('Request path "' + path + '" from N2YO API\n')
    const uri = n2yoUri + path + '?apiKey=' + n2yoApiKey

    const response = this.request('GET', uri, BACKEND_N2YO)
    const status = response.status()
    const statusText = response.statusText()
    const response_text = response.text()
    if (status != 200) {
      let message =
        'Remote responded with ' + status.toString() + ' ' + statusText
      if (response_text) {
        message += '\nResponse text:\n' + response_text + '\n'
      }
      this._lastError = new _Error(message)
      return null
    }
    Console.log('Response text: ' + response_text + '\n')
    return <JSON.Obj>JSON.parse(response_text)
  }
  /**
   * Send a request to the SpaceX GraphQL API
   *
   * Returns null and sets @see lastError() on a non-200 response
   *
   * @param query GraphQL query string
   * @returns Instance of @see JSON Obj corresponding to the server response
   */
  private spacexRequest(query: string): JSON.Obj | null {
    Console.log('Request query "' + query + '" from SpaceX API\n')
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    const queryObj = new JSON.Obj()
    queryObj.set('query', query)

    const response = this.request(
      'POST',
      spaceXUri,
      BACKEND_SPACEX,
      headers,
      queryObj.toString()
    )
    const status = response.status()
    const statusText = response.statusText()
    const response_text = response.text()
    if (status != 200) {
      let message =
        'Remote responded with ' + status.toString() + ' ' + statusText
      if (response_text) {
        message += '\nResponse text:\n' + response_text + '\n'
      }
      this._lastError = new _Error(message)
      return null
    }
    return <JSON.Obj>JSON.parse(response_text)
  }

  private request(
    method: string,
    uri: string,
    backend: string,
    headers: Headers = new Headers(),
    body: string = ''
  ): Response {
    const init: RequestInit = {
      method: method,
      headers: headers || new Headers(),
      body: String.UTF8.encode(body),
    }
    Console.log('Created request\n')
    Console.log('Request method: ' + method + '\n')
    Console.log('Request URL: ' + uri + '\n')
    Console.log('Sending request to backend "' + backend + '"\n')
    const request = new Request(uri, init)
    const response = Fastly.fetch(request, {
      backend: backend,
      cacheOverride: null,
    }).wait()
    const response_headers = response.headers()
    const keys = response_headers.keys()
    let key: string
    for (let i = 0; i < keys.length; i++) {
      let key: string = keys[i]
      const val: string = <string>(response_headers.get(key) || '')
      Console.log('Response header "' + key + '": "' + val + '"\n')
    }
    return response
  }
}

class _Error {
  readonly message: string
  readonly code: string
  constructor(message: string, code: string = '') {
    this.message = message
    this.code = code
  }

  public toString(): string {
    let str: string = ''
    if (this.code) {
      str += this.code + ': '
    }
    str += this.message
    return str
  }
}
