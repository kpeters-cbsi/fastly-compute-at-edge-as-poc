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
      url: null,
      headers: null,
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
    const missionId = 'F4F83DE'
    Console.log('initializing plotter' + '\n')
    const plotter = new SpaceXPlotter(n2yoApiKey)
    Console.log('initialized plotter' + '\n')
    const payloadTLEs = plotter.payloadTLEs(missionId)
    if (payloadTLEs) {
      Console.log('Got Payload TLEss\n')
      const obj = new JSON.Obj()
      const payloadIDs = payloadTLEs.keys()
      for (let i = 0; i < payloadIDs.length; i++) {
        const payloadId = payloadIDs[i]
        const arr = new JSON.Arr()
        const tles = payloadTLEs.get(payloadId)
        for (let j = 0; j < tles.length; j++) {
          arr.push(new JSON.Str(tles[j]))
        }
        obj.set(payloadId, arr)
      }
      return new Response(String.UTF8.encode(obj.toString()), {
        status: 200,
        headers: headers([['Content-Type', 'application/json']]),
        url: null,
      })
    } else {
      const err = plotter.lastError()
      if (!err) {
        return new Response(
          String.UTF8.encode('No TLEs found for mission "' + missionId + '"'),
          {
            status: 404,
            headers: null,
            url: null,
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

type HeaderArray = Array<string[]>

function headers(h: HeaderArray): Headers {
  const hdrs = new Headers()
  for (let i = 0; i < h.length; i++) {
    hdrs.set(h[i][0], h[i][1])
  }
  return hdrs
}

type PayloadTLEs = Map<string, string[]>

class RequestResult {
  json: JSON.Obj | null
  text: string | null
  status: u16
  statusText: string
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
   * Get the TLEs for each payload in the given mission
   *
   * @param missionId
   * @returns Map of payload ID to TLE array
   */
  public payloadTLEs(missionId: string): PayloadTLEs | null {
    Console.log('Request paylod TLEs for mission "' + missionId + '"\n')
    this._lastError = null
    const payloadIds = this.payloadIds(missionId)
    if (payloadIds) {
      const payloadTLEs = new Map<string, string[]>()
      for (let i = 0; i < payloadIds.length; i++) {
        const payloadId = payloadIds[i]
        const noradIds = this.noradIds(payloadId)
        if (noradIds) {
          const tles = this.getTLEsForNoradIds(noradIds)
          if (!tles) {
            return null
          }
          payloadTLEs.set(payloadId, tles)
        } else {
          if (this.lastError()) {
            return null
          } else {
            Console.log(
              'ERROR: No NORAD IDs for payload ' +
                payloadId +
                ' (mission ' +
                missionId +
                ')\n'
            )
            this._lastError = new _Error(
              'No NORAD IDs for payload ' +
                payloadId +
                ' (mission ' +
                missionId +
                ')'
            )
            return null
          }
        }
      }
      return payloadTLEs
    } else {
      Console.log('No payload IDs found for mission ' + missionId)
      return null
    }
  }

  private getTLEsForNoradIds(noradIds: i64[]): string[] | null {
    const tles: string[] = []
    for (let j = 0; j < noradIds.length; j++) {
      const noradId = noradIds[j]
      const _tles = this.tles(noradId)
      if (_tles) {
        for (let k = 0; k < _tles.length; k++) {
          tles.push(_tles[k])
        }
      } else {
        if (this.lastError()) {
          return null
        } else {
          Console.log(
            'ERROR: No TLEs for NORAD ID ' + noradId.toString() + '\n'
          )
          this._lastError = new _Error(
            'No TLEs found for NORAD ID ' + noradId.toString()
          )
        }
      }
    }
    return tles
  }

  public payloadIds(missionId: string): string[] | null {
    Console.log('Request paylod IDs for mission "' + missionId + '"\n')
    this._lastError = null
    const res = this.spacexRequest(
      '{ mission(id: "' + missionId + '") { payloads { id } } }'
    )
    if (!res) {
      const err = this.lastError()
      if (err) {
        Console.log('ERROR: ' + err.toString() + '\n')
      } else {
        Console.log('No payload IDs found\n')
      }
      return null
    }
    const data = res.get('data')
    if (!data) {
      Console.log('ERROR: SpaceX response missing "data" field\n')
      this._lastError = new _Error('"data" field missing in SpaceX response')
      return null
    }
    const mission = <JSON.Obj>(<JSON.Obj>data).get('mission')
    if (mission) {
      if (mission.has('payloads')) {
        const payloads = <JSON.Arr>mission.get('payloads')
        debug('payloads internal array: ' + payloads._arr.toString())
        const payloadIds: string[] = payloads._arr.map<string>(
          (val: JSON.Value) => {
            const obj = <JSON.Obj>val
            const payloadId = (<JSON.Str>obj.get('id'))._str
            return payloadId
          }
        )
        Console.log(
          payloadIds.length.toString() +
            ' payload IDs found: ' +
            payloadIds.toString() +
            '\n'
        )
        return payloadIds
      }
      Console.log('No payload IDs found\n')
    }
    Console.log('WARNING: No "mission" in SpaceX response')
    return null
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
        Console.log(
          noradIds.length.toString() +
            ' NORAD IDs found: ' +
            noradIds.toString() +
            '\n'
        )
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

    const result = this.request('GET', uri, BACKEND_N2YO)
    const status = result.status
    const statusText = result.statusText
    const responseText: string = <string>(result.text || '')
    debug('N2YO response text: ' + responseText)
    if (status != 200) {
      let message =
        'Remote ' +
        BACKEND_N2YO +
        ' responded with ' +
        status.toString() +
        ' ' +
        statusText
      this._lastError = new _Error(message)
      return null
    }
    return result.json
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

    const result = this.request(
      'POST',
      spaceXUri,
      BACKEND_SPACEX,
      headers,
      queryObj.toString()
    )
    const status = result.status
    const statusText = result.statusText
    const responseText: string = <string>(result.text || '')
    debug('SpaceX response text: ' + responseText)
    if (status != 200) {
      let message =
        'Remote ' +
        BACKEND_SPACEX +
        ' responded with ' +
        status.toString() +
        ' ' +
        statusText
      this._lastError = new _Error(message)
      return null
    }
    if (!result.json) {
      this._lastError = new _Error(
        'Remote did not respond with JSON. Response text: ' + responseText
      )
    }
    return result.json
  }

  private request(
    method: string,
    uri: string,
    backend: string,
    headers: Headers = new Headers(),
    body: string = ''
  ): RequestResult {
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
    const response_text = response.text()
    const response_headers = response.headers()
    const keys = response_headers.keys()
    for (let i = 0; i < keys.length; i++) {
      let key: string = keys[i]
      const val: string = <string>(response_headers.get(key) || '')
      Console.log('Response header "' + key + '": "' + val + '"\n')
    }

    const result: RequestResult = {
      json: null,
      text: response_text,
      status: response.status(),
      statusText: response.statusText(),
    }
    let contentType = response_headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      result.json = <JSON.Obj>JSON.parse(response_text)
    }
    return result
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

function debug(message: string): void {
  log(message, 'DEBUG')
}
function info(message: string): void {
  log(message, 'INFO')
}
function warn(message: string): void {
  log(message, 'WARN')
}
function error(message: string): void {
  log(message, 'ERROR')
}
function fatal(message: string): void {
  log(message, 'FATAL')
}

function log(message: string, level: string = 'INFO'): void {
  Console.log('[' + level + '] ' + message + '\n')
}
