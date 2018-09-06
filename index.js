/*** Websocket-ZWay Bridge ZAutomation module ****************************************

Version: 1.0.0

-------------------------------------------------------------------------------
Author: Blake Blackshear <blakeb@blakeshome.com>
Description:
  This module bridges ZWave devices over web sockets.

******************************************************************************/

// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function WebSockets (id, controller) {
  // Call superconstructor first (AutomationModule)
  WebSockets.super_.call(this, id, controller);
}

inherits(WebSockets, BaseModule);

_module = WebSockets;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

WebSockets.prototype.init = function (config) {
  var self = this;
  
  self.log("init");
  //self.log(JSON.stringify(self.controller.locations));
  // Call superclass' init (this will process config argument and so on)
  WebSockets.super_.prototype.init.call(this, config);
  
  self.initialized = true;

  self.websocketServer = config.wsServer;//"ws://blakeshome.com:9009";

  self.reconnectCount = 0;

  self.connected = false;

  self.sendQueue = [];
  
  self.connectToServer();
  
  this.loaded = false;

  self.updateTimes = {};
  
  this.updateDevice = function (device) {
      var updateTime = device.get('updateTime');
      // if we havent reported on this device before, just set a default update time of 0
      if (!(device.id in self.updateTimes)) { self.updateTimes[device.id] = 0; }
      // if the device update time is the same or less than the last time we reported, ignore
      if (updateTime <= self.updateTimes[device.id]) { return; }
      //store the update time for this device
      self.updateTimes[device.id] = updateTime;

      var room = self.findRoom(device.get('location'));
      var deviceName = device.get('metrics:title');
      var lastLevel = device.get('metrics:lastLevel');
      var level = device.get('metrics:level');
      var jsonDevice = device.toJSON();
      jsonDevice.room = room;
      self.sendMessage(JSON.stringify(jsonDevice));
  }
  
  this.findRoom = function (id) {
    if (id in this.locations){
      return this.locations[id];
    }

    var locations = self.controller.locations;
    if (locations) {
      for (var i = 0; i < locations.length; i++) {
        if (locations[i].id == id) {
          this.locations[locations[i].id] = locations[i].title;
          return locations[i].title;
        }
      }
    }
    return null;
  };
  
  this.locations = {};
  var locations = self.controller.locations;
  if (locations) {
      for (var i = 0; i < locations.length; i++) {
          this.locations[locations[i].id] = locations[i].title;
      }
  }

  this.bindZWay = function () {
    self.loaded = true;

    self.updateCallback = _.bind(self.updateDevice, self);
    self.controller.devices.on("change:metrics:level", self.updateCallback);
    self.controller.devices.on("created", self.updateCallback);
    self.controller.devices.each(self.updateCallback);
  };

  this.unbindZWay = function () {
    self.loaded = false;
    
    self.controller.devices.off("modify:metrics:level", self.updateCallback);
    self.controller.devices.off("created", self.updateCallback);
  };

  if (global.ZWave && global.ZWave['zway']) {
    this.bindZWay();
  }
  global.controller.on("ZWave.register", this.bindZWay);
  global.controller.on("ZWave.unregister", this.unbindZWay);

};

WebSockets.prototype.connectToServer = function() {
  var self = this;
  // exit the module if no longer initialized
  if(!self.initialized) return;

  self.log("Connecting...(" + self.reconnectCount + ")");
  self.reconnectCount++;
  try{
    self.sock = new sockets.websocket(self.websocketServer);
    self.sock.onopen = function () {
      self.log('Connected');
      //TODO: change this to something unique
      self.sock.send("downstairs");
      self.reconnectCount = 0;
      self.connected = true;
      self.flushQueue();
    }
    self.sock.onmessage = function(ev) {
      self.log('Received Message');
      self.log(ev.data);
      self.processMessage(ev.data);
    }
    self.sock.onclose = function() {
      self.log('Connection closed');
      self.connected = false;
      self.reconnect_timer = setTimeout(function() {self.connectToServer();}, Math.min(self.reconnectCount * 1000, 60000));
    }
    self.sock.onerror = function(ev) {
      self.log('Error');
      self.connected = false;
      self.log(ev.data);
      self.reconnect_timer = setTimeout(function() {self.connectToServer();}, Math.min(self.reconnectCount * 1000, 60000));
    }
  } catch (error){
    self.error(error);
    self.reconnect_timer = setTimeout(function() {self.connectToServer();}, Math.min(self.reconnectCount * 1000, 60000));
  }
}

WebSockets.prototype.processMessage = function(message) {
  var parsedMessage = {};
  try {
    parsedMessage = JSON.parse(message); 
  } catch (error) {
    this.log("Unable to parse message: " + error);
    return;
  }

  if(parsedMessage.command === "set") {
    this.setDevice(parsedMessage.id, parsedMessage.value);
  }
}

WebSockets.prototype.sendMessage = function(message) {
  var self = this;
  if(self.connected){
    self.sock.send(message);
  } else {
    self.sendQueue.push(message);
    self.log("Queue length: " + self.sendQueue.length);
  }
}

WebSockets.prototype.flushQueue = function() {
  var self = this;
  if(self.connected){
    while(self.sendQueue.length > 0){
      self.sock.send(self.sendQueue.shift());
    }
  } else {
    self.error("Not connected. Cannot flush queue.");
  }
}

WebSockets.prototype.setDevice = function(id, value) {
  var self = this;
  var device = self.controller.devices.get(id);
  var deviceType = device.get('deviceType');

  if (deviceType.indexOf("sensor") === 0) {
    self.error("Can't perform action on sensor " + device.get("metrics:title"));
    return;
  }

  if (deviceType === "switchMultilevel" && value !== "on" && value !== "off" && value !== "stop") {
    device.performCommand("exact", {level: value + "%"});
  } else if (deviceType === "thermostat") {
    device.performCommand("exact", {level: value});
  } else {
    device.performCommand(value);
  }
}

WebSockets.prototype.stop = function() {
  this.initialized = false;
  this.sock.close();

  if (this.loaded === true) {
    this.unbindZWay();
  }
  
  global.controller.off("ZWave.register", this.bindZWay);
  global.controller.off("ZWave.unregister", this.unbindZWay);
  
  WebSockets.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

// This module has no additional methods