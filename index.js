/* jshint asi: true, node: true, laxbreak: true, laxcomma: true, undef: true, unused: true */

// there is no known webhook/websocket to use for events, this results in very frequent polling under the push-sensor model...

var homespun    = require('homespun-discovery')
  , querystring = require('querystring')
  , pushsensor  = homespun.utilities.pushsensor
  , PushSensor  = pushsensor.Sensor
  , roundTrip   = homespun.utilities.roundtrip
  , sensorTypes = homespun.utilities.sensortypes
  , underscore  = require('underscore')
  , url         = require('url')
  , util        = require('util')


var Accessory
  , Service
  , Characteristic
  , CommunityTypes
  , UUIDGen

module.exports = function (homebridge) {
  Accessory      = homebridge.platformAccessory
  Service        = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  CommunityTypes = require('hap-nodejs-community-types')(homebridge)
  UUIDGen        = homebridge.hap.uuid

  pushsensor.init(homebridge)
  homebridge.registerPlatform('homebridge-platform-ring-video-doorbell', 'ring-video-doorbell', Ring, true)
}


var Ring = function (log, config, api) {
  if (!(this instanceof Ring)) return new Ring(log, config, api)

  this.log = log
  this.config = config || { platform: 'ring-video-doorbell' }
  this.api = api

  this.location = this.config.location || url.parse('https://api.ring.com')
  this.options = underscore.defaults(this.config.options || {}, { ttl: 4, verboseP: false })

  this.discoveries = {}
  this.doorbots = {}

  if (api) this.api.on('didFinishLaunching', this._didFinishLaunching.bind(this))
  else this._didFinishLaunching()
}

Ring.prototype._didFinishLaunching = function () {
  var self = this

  self._login(function () {
    self._refresh1(function (err) {
      if (err) {
        self.log.error('refresh1 error: ' + err.toString())
        throw err
      }

      self._refresh2(function (err) {
        if (err) {
          self.log.error('refresh2 error: ' + err.toString())
          throw err
        }

        underscore.keys(self.discoveries).forEach(function (uuid) {
          var accessory = self.discoveries[uuid]

          self.log.warn('accessory not discovered', { UUID: uuid })
          accessory.updateReachability(false)
        })

        setInterval(function () { self._refresh1.bind(self)(function (err) {
          if (err) self.log.error('refresh1 error: ' + err.toString())
        }) }, 5 * 60 * 1000)

        setInterval(function () { self._refresh2.bind(self)(function (err) {
          if (err) self.log.error('refresh2 error: ' + err.toString())
        }) }, self.options.ttl * 1000)
      })
    })
  })

  self.log('didFinishLaunching')
}

Ring.prototype._addAccessory = function (doorbot) {
  var self = this

  var accessory = new Accessory(doorbot.name, doorbot.uuid)

  accessory.on('identify', function (paired, callback) {
    self.log(accessory.displayName, ': identify request')
    callback()
  })

  if (doorbot.attachAccessory.bind(doorbot)(accessory)) self.api.updatePlatformAccessories([ accessory ])

  if (!self.discoveries[accessory.UUID]) {
    self.api.registerPlatformAccessories('homebridge-platform-ring-video-doorbell', 'ring-video-doorbell', [ accessory ])
    self.log('addAccessory', underscore.pick(doorbot, [ 'uuid', 'name', 'manufacturer', 'model', 'serialNumber' ]))
  }
}

Ring.prototype.configurationRequestHandler = function (context, request, callback) {/* jshint unused: false */
  this.log('configuration request', { context: context, request: request })
}

Ring.prototype.configureAccessory = function (accessory) {
  var self = this

  accessory.on('identify', function (paired, callback) {
    self.log(accessory.displayName, ': identify request')
    callback()
  })

  self.discoveries[accessory.UUID] = accessory
  self.log('configureAccessory', underscore.pick(accessory, [ 'UUID', 'displayName' ]))
}

/*
{ profile                              :
  { id                                 : ...
  , email                              : "user@example.com"
  , first_name                         : null
  , last_name                          : null
  , phone_number                       : null
  , authentication_token               : "..."
  , features                           :
    { remote_logging_format_storing    : false
    , remote_logging_level             : 1
    , subscriptions_enabled            : true
    , stickupcam_setup_enabled         : true
    , vod_enabled                      : false
    , nw_enabled                       : true
    , nw_user_activated                : false
    , ringplus_enabled                 : true
    , lpd_enabled                      : true
    , reactive_snoozing_enabled        : false
    , proactive_snoozing_enabled       : false
    , owner_proactive_snoozing_enabled : true
    , live_view_settings_enabled       : false
    , delete_all_settings_enabled      : false
    , power_cable_enabled              : false
    , device_health_alerts_enabled     : true
    , chime_pro_enabled                : true
    , multiple_calls_enabled           : true
    , ujet_enabled                     : false
    , multiple_delete_enabled          : false
    , delete_all_enabled               : false
    }
  }
}
*/

Ring.prototype._login = function (callback) {
  var self = this
  
  var headers =
      { Authorization     : 'Basic ' + new Buffer(self.config.username + ':' + self.config.password).toString('base64')
      , Accept            : '*/*'
      , 'User-Agent'      : 'Dalvik/1.6.0 (Linux; U; Android 4.4.4; Build/KTU84Q)'
      , 'content-type'    : 'application/x-www-form-urlencoded; charset=UTF-8'
      }
    , payload =
      { 'device[os]'                             : 'android'
      , 'device[hardware_id]'                    : '180940d0-7285-3366-8c64-6ea91491982c'
      , 'device[app_brand]'                      : 'ring'
      , 'device[metadata][device_model]'         : 'VirtualBox'
      , 'device[metadata][resolution]'           : '600x800'
      , 'device[metadata][app_version]'          : '1.7.29'
      , 'device[metadata][app_instalation_date]' : ''
      , 'device[metadata][os_version]'           : '4.4.4'
      , 'device[metadata][manufacturer]'         : 'innotek GmbH'
      , 'device[metadata][is_tablet]'            : 'true'
      , 'device[metadata][linphone_initialized]' : 'true'
      , 'device[metadata][language]'             : 'en'
      , api_version                              : '9'
      }

  roundTrip(underscore.defaults({ location: self.location, logger: self.log }, self.options),
            { method: 'POST', path: '/clients_api/session', headers: headers, payload: querystring.stringify(payload) },
  function (err, response, result) {
    if (err) {
      self.log.error('login', underscore.extend({ username: self.config.username }, err))
      return setTimeout(function () { self._login.bind(self)(callback) }, 30 * 1000)
    }

    self.profile = result.profile
    if ((!self.profile) || (!self.profile.authentication_token)) return callback(new Error('invalid session response'))

    callback()
  })
}

/*
{ "id"                  : ...
, "description"         : "Front Gate"
, "device_id"           : "..."
, "time_zone"           : "America\/Chicago"
, "subscribed"          : true
, "subscribed_motions"  : true
, "battery_life"        : 20
, "external_connection" : false
, "firmware_version"    : "1.7.189"
, "kind"                : "doorbell"
, "latitude"            : 39.8333333
, "longitude"           : -98.585522
, "address"             : ".... .... .., Lebanon, KS 66952 USA"
, "owned"               : true
, "alerts"              : 
  { "connection"        : "offline"
  , "battery"           : "low"
  }
, "owner"               :
  { "id"                : ...
  , "first_name"        : null
  , "last_name"         : null
  , "email"             : "user@example.com"
  }
}
 */

Ring.prototype._refresh1 = function (callback) {
  var self = this

  var headers =
      { Accept            : '*/*'
      , 'User-Agent'      : 'Dalvik/1.6.0 (Linux; U; Android 4.4.4; Build/KTU84Q)'
      }
    , query = '?' + querystring.stringify({ api_version: '9', auth_token: self.profile.authentication_token })

  roundTrip(underscore.defaults({ location: self.location, logger: self.log }, self.options),
            { path: '/clients_api/ring_devices' + query, headers: headers },
  function (err, response, result) {
    if (err) return callback(err)

    if ((!result) || (!result.doorbots)) result = { doorbots: [] }
    result.doorbots.forEach(function (service) {
      var capabilities, properties
        , doorbotId = service.id
        , doorbot = self.doorbots[doorbotId]

      if (!doorbot) {
        capabilities = underscore.pick(sensorTypes,
                                       [ 'battery_level', 'battery_low', 'motion_detected', 'reachability', 'ringing' ])
        properties = { name             : service.description
                     , manufacturer     : 'Bot Home Automation, Inc.'
                     , model            : service.kind
                     , serialNumber     : service.id.toString()
                     , firmwareRevision : service.firmware_version
                     , hardwareRevision : ''
                     }

        doorbot = new Doorbot(self, service.device_id, { capabilities: capabilities, properties: properties })
        self.doorbots[doorbotId] = doorbot
      }

      doorbot.readings = { battery_level : service.battery_life
                         , battery_low   : (service.alerts) && (service.alerts.battery == 'low')
                                               ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
                                               : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
                         , reachability  : (service.alerts) && (service.alerts.connection !== 'offline')
                         }
      doorbot._update.bind(doorbot)(doorbot.readings)
    })

    callback()
  })
}

/*
[
  {
    "id"                     : ...,
    "state"                  : "ringing",
    "protocol"               : "sip",
    "doorbot_id"             : ...,
    "doorbot_description"    : "Front Gate",
    "device_kind"            : "doorbell",
    "motion"                 : false,
    "kind"                   : "ding",
    "sip_server_ip"          : "a.b.c.d"
    "sip_server_port"        : "15063",
    "sip_server_tls"         : "false",
    "sip_session_id"         : "...",
    "sip_from"               : "sip:...@ring.com",
    "sip_to"                 : "sip:...@a.b.c.d:15063;transport=tcp",
    "audio_jitter_buffer_ms" : 0,
    "video_jitter_buffer_ms" : 0,
    "sip_endpoints"          : null,
    "expires_in"             : 171,
    "now"                    : 1483114179.70994,
    "optimization_level"     : 3,
    "sip_token"              : "..."
    "sip_ding_id"            : "..."
  }
]
 */

Ring.prototype._refresh2 = function (callback) {
  var self = this

  var headers =
      { Accept            : '*/*'
      , 'User-Agent'      : 'Dalvik/1.6.0 (Linux; U; Android 4.4.4; Build/KTU84Q)'
      }
    , query = '?' + querystring.stringify({ api_version: '9', auth_token: self.profile.authentication_token })

  roundTrip(underscore.defaults({ location: self.location, logger: self.log }, self.options), 
            { path: '/clients_api/dings/active' + query, headers: headers },
  function (err, response, result) {
    if (err) return callback(err)

    if (!util.isArray(result)) return callback(new Error('not an Array: ' + typeof result))

    underscore.keys(self.doorbots).forEach(function (doorbotId) {          
      underscore.extend(self.doorbots[doorbotId].readings, { motion_detected: false, ringing: false })
    })
    result.forEach(function (event) {
      var doorbot

      if (event.state !== 'ringing') return
      
      doorbot = self.doorbots[event.doorbot_id]
      if (!doorbot) return self.log.error('dings/active: no doorbot', event)

      underscore.extend(doorbot.readings, { motion_detected : (event.kind === 'motion') || (event.motion)
                                          , ringing         : event.kind === 'ding' })
    })
    underscore.keys(self.doorbots).forEach(function (doorbotId) {          
      var doorbot = self.doorbots[doorbotId]

      doorbot._update.bind(doorbot)(doorbot.readings)
    })

    callback()
  })
}


var Doorbot = function (platform, doorbotId, service) {
  if (!(this instanceof Doorbot)) return new Doorbot(platform, doorbotId, service)

  PushSensor.call(this, platform, doorbotId, service)
}
util.inherits(Doorbot, PushSensor);
