import {
  Request,
  Response,
  Fastly,
  Headers,
  RequestInit,
} from '@fastly/as-compute'
import { JSON } from './lib/assemblyscript-json'
import { Console, Date } from 'as-wasi'

/**
 * Maximum number of HTTP transactions to execute
 *
 * Necessary because Fastly imposes a limit of 8 requests / execution
 */
const TXN_LIMIT = 6

const BACKEND_SPACEXDATA = 'SpaceXData'
const BACKEND_N2YO = 'n2yo'

const n2yoApiKey = 'YBLNQJ-JUG3KB-XS5BRT-1JX2'
const spaceXDataUri = 'https://api.spacexdata.com/v3/'
const n2yoUri = 'https://api.n2yo.com/rest/v1/satellite/'

// The entry point for your application.
//
// Use this function to define your main request handling logic. It could be
// used to route based on the request properties (such as method or path), send
// the request to a backend, make completely new requests, and/or generate
// synthetic responses.
function main(req: Request): Response {
  debug('******************************************************')
  debug('Request: ' + req.method() + ' ' + req.url())

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
      const payloadTLEs = plotter.payloadTLEs(missionId)
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
        return notFound('No TLEs found for mission ' + missionId)
      }
      responseObj.set('payloads', payloadsArr)
      const headers = new Headers()
      headers.set('content-type', 'application/json')
      return ok(responseObj.toString(), headers)
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
  private _txnCount: i32

  constructor(n2yoApiKey: string) {
    this.n2yoApiKey = n2yoApiKey
  }

  public txnCount(): i32 {
    return this._txnCount
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
    let t0: f64 = Date.now()
    debug('Request payload TLEs for mission "' + missionId)
    this._lastError = null
    const noradIds = this.noradIdsForMission(missionId)
    this.logElapsed(t0, 'get NORAD IDs')
    if (noradIds) {
      const payloadTLEs = new Map<string, string[]>()
      const payloadIds = noradIds.keys()
      for (let i = 0; i < payloadIds.length; i++) {
        const payloadId = payloadIds[i]
        let t0 = Date.now()
        let noradIdsForPayload = noradIds.get(payloadId)
        const txnCount = this.txnCount()
        debug(
          'TXN count: ' +
            txnCount.toString() +
            ' TXN limit: ' +
            TXN_LIMIT.toString()
        )
        if (txnCount < TXN_LIMIT) {
          const limit = TXN_LIMIT - txnCount
          if (limit > noradIdsForPayload.length) {
            debug(
              'Get TLEs for all ' +
                noradIdsForPayload.length.toString() +
                ' NORAD IDs in payload'
            )
          } else {
            debug(
              'Get ' +
                limit.toString() +
                '/' +
                noradIdsForPayload.length.toString() +
                ' TLEs'
            )
          }
          // only get as many TLEs as we have available requests
          noradIdsForPayload = noradIdsForPayload.slice(0, limit)
          debug('Get TLEs for NORAD IDs ' + noradIdsForPayload.toString())
          const tles = this.getTLEsForNoradIds(noradIdsForPayload)
          this.logElapsed(
            t0,
            'get TLEs for NORAD IDs ' + noradIdsForPayload.toString()
          )
          if (!tles) {
            return null
          }
          payloadTLEs.set(payloadId, tles)
        } else {
          payloadTLEs.set(payloadId, [])
        }
      }
      this.logElapsed(t0, 'payloadTLEs()')
      return payloadTLEs
    } else {
      if (!this.lastError()) {
        info('No NORAD IDs found for mission ' + missionId)
      }
      return null
    }
  }

  private getTLEsForNoradIds(noradIds: i64[]): string[] | null {
    debug('Get TLEs for NORAD IDs ' + noradIds.toString())
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

  private noradIdsForMission(missionId: string): Map<string, i64[]> | null {
    debug('Request NORAD IDs for mission "' + missionId + '"')
    this._lastError = null
    const filter = new Map<string, string>()
    filter.set('mission_id', missionId)
    filter.set('filter', 'rocket/second_stage/payloads/(payload_id,norad_id)')
    const res = this.spacexDataRequest('launches', filter)
    if (!res) {
      const err = this.lastError()
      if (err) {
        error(err.toString())
      } else {
        info('No NORAD IDs found for mission ' + missionId)
      }
      return null
    }
    debug('NORAD IDs request successful')
    const data = <JSON.Arr>res
    const ret = new Map<string, i64[]>()
    debug(data._arr.length.toString() + ' items in response')
    for (let i = 0; i < data._arr.length; i++) {
      const obj = <JSON.Obj>data._arr[i]
      debug('Got obj ' + i.toString())
      const rocket = <JSON.Obj>obj.get('rocket')
      debug('Got obj ' + i.toString() + ' rocket')
      const second_stage = <JSON.Obj>rocket.get('second_stage')
      debug('Got obj ' + i.toString() + ' rocket / second_stage')
      const payloads = <JSON.Arr>second_stage.get('payloads')
      debug('Got obj ' + i.toString() + ' rocket / second_stage / payloads')
      debug(payloads._arr.length.toString() + ' payloads')
      for (let j = 0; j < payloads._arr.length; j++) {
        const payload = <JSON.Obj>payloads._arr[j]
        debug('got payload ' + j.toString())
        const payloadId = (<JSON.Str>payload.get('payload_id'))._str
        debug('got payload ' + j.toString() + ' payload_id')

        const norad_id = (<JSON.Arr>payload.get('norad_id'))._arr
        debug('got payload ' + j.toString() + ' norad_id')
        debug(norad_id.length.toString() + ' NORAD IDs')
        const noradIds: i64[] = norad_id.map<i64>(
          (val: JSON.Value) => (<JSON.Num>val)._num
        )
        ret.set(payloadId, noradIds)
      }
    }
    return ret
  }

  /**
   * Return the two line orbital elements (TLE) for the given NORAD ID
   *
   * @param noradId
   * @returns the TLEs as an array of strings.
   */
  private tles(noradId: i64): string[] | null {
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

    //const override = new Fastly.CacheOverride()
    //override.setPass()
    //const result = this.request('GET', uri, BACKEND_N2YO, null, null, override)
    const result = this.request('GET', uri, BACKEND_N2YO, null, null)
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

  private spacexDataRequest(
    path: string,
    filter: Map<string, string> = new Map<string, string>()
  ): JSON.Value | null {
    debug('Request path "' + path + '" from SpaceXData API')
    let uri = spaceXDataUri + path
    const keys = filter.keys()
    if (keys.length) {
      for (let i = 0; i < keys.length; i++) {
        let joint = i == 0 ? '?' : '&'
        const key = keys[i]
        const val = filter.get(key)
        uri = uri + joint + key + '=' + val
      }
    }
    const override = new Fastly.CacheOverride()
    override.setTTL(86400)
    override.setSWR(86400)
    override.deletePass()
    const result = this.request('GET', uri, BACKEND_SPACEXDATA, null, null, override)
    const status = result.status
    if (status != 200) {
      const statusText = result.statusText
      let message =
        'Remote ' +
        BACKEND_SPACEXDATA +
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
      return null
    } else {
      const resultJson = <JSON.Obj>result.json
      if (resultJson.has('errors')) {
        const errors = <JSON.Arr>resultJson.get('errors')
        const error = <JSON.Obj>errors._arr[0]
        if (error.has('message')) {
          this._lastError = new _Error(
            'Remote indicated a problem: ' +
              (<JSON.Str>error.get('message'))._str
          )
          return null
        }
      }
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
    const t0: f64 = Date.now()
    const init: RequestInit = {
      method: method,
      headers: headers,
      body: null,
    }
    if (body) {
      init.body = String.UTF8.encode(body)
    }
    this._txnCount++
    debug(
      'TXN ' +
        this.txnCount().toString() +
        ' (' +
        backend +
        ') ' +
        method +
        ' ' +
        uri
    )
    const request = new Request(uri, init)
    debug('TXN ' + this.txnCount().toString() + ' Fetching request')
    const response = Fastly.fetch(request, {
      backend: backend,
      cacheOverride,
    }).wait()
    debug(
      'TXN ' +
        this.txnCount().toString() +
        ' (' +
        backend +
        ') Request complete'
    )
    const response_text = response.text()
    debug(
      'TXN ' +
        this.txnCount().toString() +
        ' (' +
        backend +
        ') Response text: ' +
        response_text
    )
    const response_headers = response.headers()
    const cache = response_headers.get('x-cache')
    const cacheHits = response_headers.get('x-cache-hits')
    let logMessage = '(' + backend + ') Cache: ' + <string>cache
    if (cache != 'MISS') {
      logMessage = logMessage + ' hits: ' + <string>cacheHits
    }
    info('TXN ' + this.txnCount().toString() + ' ' + logMessage)
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
      debug('TXN ' + this.txnCount().toString() + ' parsing JSON')
      result.json = <JSON.Obj>JSON.parse(response_text)
      debug('TXN ' + this.txnCount().toString() + ' parsed JSON')
    }
    this.logElapsed(
      t0,
      'TXN ' + this.txnCount().toString() + ' ' + backend + ' request'
    )
    return result
  }

  private logElapsed(t0: f64, message: string): void {
    const t1 = Date.now()

    const elapsed: f64 = t1 - t0
    info('Elapsed in ' + message + ': ' + elapsed.toString() + ' ms')
  }
}

class _Error {
  readonly message: string
  readonly code: string | null
  constructor(message: string, code: string | null = null) {
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
function error(message: string): void {
  log(message, 'ERROR')
}
function fatal(message: string): void {
  log(message, 'FATAL')
}

function log(message: string, level: string = 'INFO'): void {
  Console.log('[' + level + '] ' + message + '\n')
}
