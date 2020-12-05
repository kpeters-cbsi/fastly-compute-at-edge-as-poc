import {
  Request,
  Response,
  Fastly,
  Headers,
  RequestInit,
} from '@fastly/as-compute'
import { JSON } from './lib/assemblyscript-json'
import { Console } from 'as-wasi'

/**
 * Maximum number of payloads to return for a given misison
 *
 * Necessary because Fastly imposes a limit of 8 requests / execution
 */
const PAYLOAD_LIMIT = 3

const BACKEND_SPACEX = 'SpaceX'
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
  debug('Request: ' + req.method() + ' ' + req.url())

  Console.error('This is a test error\n')

  // We can filter requests that have unexpected methods.
  const VALID_METHODS = ['GET']
  if (!VALID_METHODS.includes(req.method())) {
    info('Request method "' + req.method() + '" is invalid')
    return response('This method is not allowed', 405)
  }

  const urlParts = req.url().split('//').pop().split('/')
  let host = urlParts.shift()
  let path = '/' + urlParts.join('/')
  debug('URL parts: ' + urlParts.toString())
  debug('Host: ' + host)
  debug('Path: ' + path)

  let limit: i32 = PAYLOAD_LIMIT
  if (req.headers().has('x-payload-limit')) {
    limit = <i32>Number.parseInt(<string>req.headers().get('x-payload-limit'))
  }
  if (urlParts[0] == 'tle') {
    if (urlParts.length < 2) {
      urlParts.push('')
    }
    const missionId = urlParts[1]
    if (missionId) {
      info('Request TLEs for mission ID "' + missionId + '"')
      debug('Initializing plotter')
      const plotter = new SpaceXPlotter(n2yoApiKey)
      debug('Initialized plotter')
      const payloadTLEs = plotter.payloadTLEs(missionId, limit)
      const responseObj = new JSON.Obj()
      const missionObj = new JSON.Obj()
      const payloadsArr = new JSON.Arr()
      missionObj.set('id', missionId)
      responseObj.set('mission', missionObj)
      if (payloadTLEs) {
        debug('Got Payload TLEs\n')
        const payloadIDs = payloadTLEs.keys()

        for (let i = 0; i < payloadIDs.length; i++) {
          const payloadObj = new JSON.Obj()
          const payloadId = payloadIDs[i]
          payloadObj.set('id', payloadId)
          payloadObj.set('tles', JSON.from(payloadTLEs.get(payloadId)))
          payloadsArr.push(payloadObj)
        }
      } else {
        const err = plotter.lastError()
        if (err) {
          return internalServerError(err.toString())
        }
      }
      responseObj.set('payloads', payloadsArr)
      return ok(responseObj.toString())
    }
  }

  return badRequest()
}

function ok(body: string, headers: Headers = new Headers()): Response {
  return response(body, 200, headers)
}

function badRequest(body: string = 'Unsupported request'): Response {
  return response(body, 400)
}

function notFound(
  body: string = 'The requested resource was not found'
): Response {
  return response(body, 404)
}

function internalServerError(
  body: string = 'There was an internal error'
): Response {
  return response(body, 500)
}

function response(
  body: string,
  status: u16,
  headers: Headers = new Headers(),
  url: string | null = null
): Response {
  return new Response(String.UTF8.encode(body), {
    status,
    url,
    headers,
  })
}

// Get the request from the client.
let req = Fastly.getClientRequest()

// Pass the request to the main request handler function.
let resp = main(req)

// Send the response back to the client.
Fastly.respondWith(resp)

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
  public payloadTLEs(
    missionId: string,
    payloadLimit: i32 = 0
  ): PayloadTLEs | null {
    Console.log('Request paylod TLEs for mission "' + missionId + '"\n')
    this._lastError = null
    const payloadIds = this.payloadIds(missionId, payloadLimit)
    if (payloadIds) {
      const payloadTLEs = new Map<string, string[]>()
      if (payloadLimit) {
        info('Limit TLEs to ' + payloadLimit.toString() + ' payloads')
      } else {
        payloadLimit = payloadIds.length
      }
      for (let i = 0; i < payloadIds.length; i++) {
        const payloadId = payloadIds[i]
        if (i < payloadLimit) {
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
        } else {
          payloadTLEs.set(payloadId, [])
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

  public payloadIds(missionId: string, limit: i32): string[] | null {
    debug('Request paylod IDs for mission "' + missionId)
    this._lastError = null
    const res = this.spacexRequest(
      '{ mission(id: "' + missionId + '") { payloads { id } } }'
    )
    if (!res) {
      const err = this.lastError()
      if (err) {
        error(err.toString())
      } else {
        info('No payload IDs found')
      }
      return null
    }
    const data = res.get('data')
    if (!data) {
      fatal('SpaceX response missing "data" field')
      this._lastError = new _Error('"data" field missing in SpaceX response')
      return null
    }
    const mission = <JSON.Obj>(<JSON.Obj>data).get('mission')
    if (mission) {
      if (mission.has('payloads')) {
        const payloads = <JSON.Arr>mission.get('payloads')
        debug('payloads internal array: ' + payloads._arr.toString())
        if (payloads._arr.includes(new JSON.Null())) {
          debug('Mission contains null payloads')
        }
        let payloadIds: string[] = payloads._arr
          .map<string>((val: JSON.Value) => {
            const obj = <JSON.Obj>val
            const payloadId = (<JSON.Str>obj.get('id'))._str
            return payloadId
          })
          .filter((payloadId) => !!payloadId)
        debug(
          payloadIds.length.toString() +
            ' non-null payload IDs found: ' +
            payloadIds.toString()
        )
        return payloadIds
      }
      info('No payload IDs found')
    }
    warn('No "mission" in SpaceX response')
    return null
  }

  /**
   * Return the NORAD ID(s) for the given SpaceX payload
   *
   * @param payloadId SpaceX payload ID
   * @returns Array of NORAD IDs. Null can indicate both 'no IDs found' and an error; check @see lastError() to see what's what
   */
  public noradIds(payloadId: string): i64[] | null {
    debug('Request NORAD IDs for payload "' + payloadId)
    this._lastError = null
    const res = this.spacexRequest(
      '{ payload(id: "' + payloadId + '") { norad_id } }'
    )
    if (!res) {
      const err = this.lastError()
      if (err) {
        error(err.toString())
      } else {
        info('No NORAD IDs found')
      }
      return null
    }
    const data = res.get('data')
    if (!data) {
      fatal('ERROR: SpaceX response missing "data" field\n')
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
        debug(
          noradIds.length.toString() +
            ' NORAD IDs found: ' +
            noradIds.toString()
        )
        return noradIds
      }
      info('No NORAD IDs found')
    }
    warn('WARNING: No "payload" in SpaceX response')
    return null
  }

  /**
   * Return the two line orbital elements (TLE) for the given NORAD ID
   *
   * @param noradId
   * @returns the TLEs as an array of strings.
   */
  public tles(noradId: i64): string[] | null {
    debug('Request TLEs for NORAD ID ' + noradId.toString())
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
      fatal('ERROR: N2YO response missing "tle" field')
      this._lastError = new _Error('"tle" field missing in N2YO response')
      return null
    }
    const arr = tle._str.split('\r\n')
    return arr
  }

  private n2yoRequest(path: string): JSON.Obj | null {
    debug('Request path "' + path + '" from N2YO API')
    const uri = n2yoUri + path + '?apiKey=' + n2yoApiKey

    const override = new Fastly.CacheOverride()
    override.setPass()
    const result = this.request('GET', uri, BACKEND_N2YO, null, null, override)
    const status = result.status
    if (status != 200) {
      const statusText = result.statusText
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
    debug('Request query "' + query + '" from SpaceX API')
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
    if (status != 200) {
      const statusText = result.statusText
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
      let resultText: string = result.text != null ? <string>result.text : ''
      this._lastError = new _Error(
        'Remote did not respond with JSON. Response text: ' + resultText
      )
    }
    return result.json
  }

  private request(
    method: string,
    uri: string,
    backend: string,
    headers: Headers | null = null,
    body: string | null = null,
    cacheOverride: Fastly.CacheOverride | null = null
  ): RequestResult {
    const init: RequestInit = {
      method: method,
      headers: headers,
      body: null,
    }
    if (body) {
      init.body = String.UTF8.encode(body)
    }
    debug('(' + backend + ') ' + method + ' ' + uri)
    const request = new Request(uri, init)
    debug('Fetching request')
    const response = Fastly.fetch(request, {
      backend: backend,
      cacheOverride,
    }).wait()
    debug('(' + backend + ') Request successful')
    const response_text = response.text()
    debug('(' + backend + ') Response text: ' + response_text)
    const response_headers = response.headers()
    // const keys = response_headers.keys()
    // for (let i = 0; i < keys.length; i++) {
    //   let key: string = keys[i]
    //   const val: string = <string>(response_headers.get(key) || '')
    //   Console.log('Response header "' + key + '": "' + val + '"\n')
    // }

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
