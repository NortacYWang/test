// runs the function on initial load
/**
 * initializes the History feature
 */
import _ from "lodash";
import moment from "moment";

// Internal
import Utils from "sccUtils";
import Language from "sccLanguage";
import Alert from "sccAlert";
import log from "loglevel";
import TimeUtils from "sccTimeUtils";

// the old errorLimit is 50000, warningLimit is 10000, decrease the number here to test performance in production
const errorLimit = 15000;
const warningLimit = 3000;

class Historic {
  constructor() {
    this.moduleName = "history";
    this.routeUrl = Utils.apiUrlPrefix + "/history";
    this.pageUrl = "history.html";

    // holds the query parameters
    this.queryParams = {
      devices: [],
      groups: [],
      startTimestamp: 0,
      endTimestamp: 0,
    };

    // holds the history data loaded from the DB keyed by type
    this._eventsByType = {};

    // master clone of the _eventsByType object
    this._eventsByTypeMaster = {};

    // keeps list of all events, sorted by event_timestamp
    this._allEvents = [];

    // hold all reports and alert-reports
    this._allProcess = {};

    // holds history events keyed by report
    this._reportsById = {};

    // event group by timestamp
    this._eventsByTimestamp = {};

    // events order by timestamp
    this._eventOrderByTimestamp = {};

    // holds the progress of sorted events
    this._progress = [];

    // holds all alerts start and end time
    this.alerts = {};

    // holds the progress of sorted report events by device id
    this._progressReport = {};

    // holds the progress bar timestamp value
    this.currentTimestamp = 0;

    // the speed rate of playing
    this.playSpeed = 1;

    // holds the current event played
    this.currentEvent = null;

    this.loadingHistory = false;

    // holds user selected options for the history module
    this.playOptions = {
      // event type show/hide setting
      event: {
        emergency: true,
        speed: true,
        geofence: true,
        cargo: true,
        non_report: true,
        report: true,
        vehicle: true,
      },
      // device options keyed by device id
      device: {
        /*
				 <id>:{
					 showTrail: [Boolean]
					 showTracks: [Boolean]
					 trailColor: [String]
				 } 
				 */
      },
    };

    this.dictOfAlertTitles = {
      emergency: "Emergency",
      speed: "Speed",
      geofence: "Geofence",
      cargo: "Cargo",
      non_report: "Non-Report",
      vehicle: "Vehicle",
    };

    //Variable that determines if 'Hide No Events checkbox should be shown
    this.showHideNoEvents = false;
  }

  init() {
    //if(Permission.default.verify("history", "view")){
    //this.translateTitle();
    return Promise.resolve();
  }

  translateTitle() {
    document.title =
      Language.translate("History") +
      " | SCCTitan " +
      Language.translate("Platform");
  }

  getEndTimestamp() {
    return moment(this.queryParams.endTimestamp).unix();
  }

  getStartTimestamp() {
    return moment(this.queryParams.startTimestamp).unix();
  }

  /**
   * loads history data categorized by event types given the query parameters
   * @param {Array|Number} devices list of device ids
   * @param {*} startTimestamp start timestamp
   * @param {*} endTimestamp end timestamp
   * @return {Object} returns list of history events categorized by event types
   */
  loadData(devices, startTimestamp, endTimestamp) {
    const $this = this;

    // clear data from previous call
    this.clearStructures();

    // set the current timestamp
    this.currentTimestamp = startTimestamp;

    // build device options object
    devices = _.concat([], devices);
    this.buildDeviceOptions(devices);

    const options = {
      url:
        this.routeUrl +
        "/[" +
        devices +
        "]/" +
        startTimestamp +
        "/" +
        endTimestamp,
      method: "GET",
      data: {},
    };

    return Utils.httpRequestHandler(options)
      .then((response) => {
        // to save communication bandwidth, the json has been compressed by avoiding key repetition in array of objects
        // the following puts the structure back to standard array of objects
        const historyData = response.data.result;

        this._eventsByTypeMaster = $this.buildEventsByType(historyData);

        log.debug("historic data loaded", $this._eventsByTypeMaster);
        $this.buildEventStructures($this._eventsByTypeMaster);

        // $this.recordAlertsLife($this._eventsByTypeMaster);
        const alerts = $this.recordAlertsLife(this._eventsByTypeMaster);

        $this.buildEventsReport(alerts, $this._eventsByTypeMaster);

        // initializing progress object to start from start timestamp
        // $this.fastPlayTo(startTimestamp - 1);

        return Promise.resolve($this._eventsByType);
      })
      .catch((err) => {
        // Utils.notify({
        //   message: Language.translate(err.message),
        //   type: "error",
        //   title: Language.translate("Historic Data"),
        // });
        log.error(err);
      });
  }

  /**
   * Store all alerts start and end time
   * @param {Object} eventsByType events by alert types
   * @return {Object} alertType {alertId, start, end}
   */
  recordAlertsLife(eventsByType) {
    let alerts = {};
    _.each(eventsByType, (alertsGroup, key) => {
      if (key !== "report" && alertsGroup?.length > 0) {
        _.each(alertsGroup, (singleAlert) => {
          if (!alerts[key]) {
            alerts[key] = {};
          }

          if (key === "vehicle") {
            if (
              !alerts[key][singleAlert.alert_id] &&
              singleAlert.alert_started
            ) {
              alerts[key][singleAlert.alert_id] = {
                alertId: singleAlert.alert_id,
                deviceId: singleAlert.device_id,
                vehicleTypeId: singleAlert.vehicle_alert_type_id,
                start: singleAlert.event_timestamp,
              };
            } else if (
              alerts[key][singleAlert.alert_id] &&
              !singleAlert.alert_started
            ) {
              alerts[key][singleAlert.alert_id] = {
                ...alerts[key][singleAlert.alert_id],
                end: singleAlert.event_timestamp,
              };
            } else if (
              !alerts[key][singleAlert.alert_id] &&
              !singleAlert.alert_started
            ) {
              alerts[key][singleAlert.alert_id] = {
                alertId: singleAlert.alert_id,
                deviceId: singleAlert.device_id,
                vehicleTypeId: singleAlert.vehicle_alert_type_id,
                end: singleAlert.event_timestamp,
              };
            }
          } else {
            if (
              !alerts[key][singleAlert.alert_id] &&
              singleAlert.alert_started
            ) {
              alerts[key][singleAlert.alert_id] = {
                alertId: singleAlert.alert_id,
                deviceId: singleAlert.device_id,
                start: singleAlert.event_timestamp,
              };
            } else if (
              alerts[key][singleAlert.alert_id] &&
              !singleAlert.alert_started
            ) {
              alerts[key][singleAlert.alert_id] = {
                ...alerts[key][singleAlert.alert_id],
                end: singleAlert.event_timestamp,
              };
            } else if (
              !alerts[key][singleAlert.alert_id] &&
              !singleAlert.alert_started
            ) {
              alerts[key][singleAlert.alert_id] = {
                alertId: singleAlert.alert_id,
                deviceId: singleAlert.device_id,
                end: singleAlert.event_timestamp,
              };
            }
          }
        });
      }
    });

    this.alerts = alerts;
    return alerts;
  }

  buildEventReport(event, allReports) {
    if (event.report_id) {
      return _.find(
        allReports,
        (report) => report.report_id === event.report_id
      );
    }
  }

  buildAllReports(allEvents) {
    const allReports = _.filter(allEvents, (e) => e.event === "report");

    return allReports;
  }

  buildIfEventHasAlerts(alerts, timestamp, deviceId) {
    let result = [];

    _.each(alerts, (alertGroup, type) => {
      _.each(alertGroup, (alert, key) => {
        if (alert?.start <= timestamp && deviceId === alert.deviceId) {
          if (!alert.end) {
            result.push({ alertId: key, type: type });
          } else if (alert.end && alert?.end > timestamp) {
            result.push({ alertId: key, type: type });
          }
          return;
        }
        return;
      });
    });

    return result;
  }

  buildEventsReport(alerts, eventsByType) {
    const allEvents = this.buildSortedAllEvents(eventsByType);
    const allReports = this.buildAllReports(allEvents);

    const filteredReports = [];
    _.each(allEvents, (event) => {
      let deviceReport =
        event.event === "report"
          ? Object.assign({}, event)
          : Object.assign({}, this.buildEventReport(event, allReports));
      const alertsForThisReport = this.buildIfEventHasAlerts(
        alerts,
        event.event_timestamp,
        event.device_id
      );

      if (alertsForThisReport.length > 0) {
        deviceReport.alerts = {};
        alertsForThisReport.forEach((alert) => {
          switch (alert.type) {
            case "emergency":
            case "non_report":
              deviceReport.alerts[alert.type] =
                deviceReport.alerts[alert.type] || {};
              deviceReport.alerts[alert.type][alert.alertId] =
                true;
              break;
            case "geofence":
            case "speed":
            case "cargo":
              deviceReport.alerts[alert.type] =
                deviceReport.alerts[alert.type] || {};
              deviceReport.alerts[alert.type][alert.alertId] =
                deviceReport.alerts[alert.type][alert.alertId] || {};
              deviceReport.alerts[alert.type][alert.alertId].alert_started =
                true;
              break;
            case "vehicle":
              deviceReport.alerts[alert.type] =
                deviceReport.alerts[alert.type] || {};
              deviceReport.alerts[alert.type][alert.alertId] =
                deviceReport.alerts[alert.type][alert.alertId] || {};
              deviceReport.alerts[alert.type][alert.alertId].alert_started =
                true;
              deviceReport.alerts[alert.type][alert.alertId].vehicleTypeId =
                event.vehicle_alert_type_id;
              break;
            default:
              break;
          }
        });
      }

      deviceReport.event_timestamp = event.event_timestamp;

      filteredReports.push(deviceReport);

    });


    this._allProcess = filteredReports;

    return filteredReports;
  }

  checkIfEventHasAlerts(timestamp, deviceId) {
    let result = [];

    _.each(this.alerts, (alertGroup, type) => {
      _.each(alertGroup, (alert) => {
        if (alert?.start <= timestamp && deviceId === alert.deviceId) {
          if (!alert.end) {
            !result.includes(type) && result.push(type);
          } else if (alert.end && alert?.end > timestamp) {
            !result.includes(type) && result.push(type);
          }
          return;
        }
        return;
      });
    });

    return result;
  }

  /**
   * Validates size of the historic data set and throws Error or Warning notification to the UI based on the limit violations
   * @param {Array|Number} devices list of device ids
   * @param {*} startTimestamp start timestamp
   * @param {*} endTimestamp end timestamp
   * @return {Object} size of of the historic data set
   */
  validateDataSet(devices, startTimestamp, endTimestamp) {
    const options = {
      url:
        this.routeUrl +
        "/size/[" +
        devices +
        "]/" +
        startTimestamp +
        "/" +
        endTimestamp,
      method: "GET",
      data: {},
    };

    return Utils.httpRequestHandler(options)
      .then((response) => {
        let dataSize = response.data.result;

        let validationObj = {
          is_valid: true,
          type: "",
        };

        if (dataSize >= errorLimit) {
          validationObj.is_valid = false;
          validationObj.type = "error";
        } else if (dataSize >= warningLimit && dataSize < errorLimit) {
          validationObj.type = "warning";
        }
        return Promise.resolve(validationObj);
      })
      .catch((err) => {
        Utils.notify({
          message: Language.translate(err.message),
          type: "error",
          title: Language.translate("History"),
        });
        log.error(err);
      });
  }

  buildEventStructures(eventsByType) {
    this._progress = [];
    this._progressReport = {};
    this.currentEvent = null;
    this._eventsByType = _.cloneDeep(eventsByType);
    this._eventsByType = this.removeHiddenDevices(this._eventsByType);
    this._reportsById = _.keyBy(this._eventsByType.report, "report_id");
    this._allEvents = this.buildSortedAllEvents(this._eventsByType);
    this._eventsByTimestamp = _.groupBy(this._allEvents, "event_timestamp");
    this._eventOrderByTimestamp = _.orderBy(
      this._allEvents,
      ["event_timestamp", "event"],
      ["asc", "asc"]
    );
    this.setEventExtraAttributes(this._allEvents);
    this.processAndFilterDevicesWithEvents(this._allEvents);
  }

  resetEventsStructures() {
    this.buildEventStructures(this._eventsByTypeMaster);
  }

  /*
		This function processes and filters out and toggles the follow option to false, 
		for the devices that have no events within the Historical query period.
	*/
  processAndFilterDevicesWithEvents(allEvents) {
    const startTimestamp = this.getStartTimestamp();
    const endTimestamp = this.getEndTimestamp();
    const selectedDevices = this.queryParams.devices;
    const $this = this;
    let devicesWithEvents = [];

    _.map(allEvents, function (event) {
      if (
        event.event_timestamp >= startTimestamp &&
        event.event_timestamp <= endTimestamp
      ) {
        devicesWithEvents.push(event.device_id);
      }
      return;
    });

    devicesWithEvents = _.uniq(devicesWithEvents);
    const devicesWithNoEvents = _.difference(
      selectedDevices,
      devicesWithEvents
    );

    if (devicesWithNoEvents.length > 0) {
      this.showHideNoEvents = true;
    } else if (devicesWithNoEvents.length == 0) {
      this.showHideNoEvents = false;
    }

    _.map(devicesWithEvents, function (deviceId) {
      $this.playOptions.device[deviceId].isFollow = true;
      $this.playOptions.device[deviceId].noEvents = false;
      //This parameter keeps track of whether a particular device originally has events.
      $this.playOptions.device[deviceId].hasEvents = true;
    });

    _.map(devicesWithNoEvents, function (deviceId) {
      $this.playOptions.device[deviceId].isFollow = false;

      if (!$this.playOptions.device[deviceId].hasEvents) {
        $this.playOptions.device[deviceId].noEvents = true;
      }
    });
  }

  removeHiddenDevices(eventsByType) {
    const $this = this;
    const newEventsByType = {};
    _.each(eventsByType, (events, eventName) => {
      newEventsByType[eventName] = _.filter(events, (event) => {
        return $this.showDeviceTrack(event.device_id);
      });
    });
    return newEventsByType;
  }

  showDeviceTrack(deviceId) {
    if (!this.playOptions.device[deviceId]) return false;
    return this.playOptions.device[deviceId].showTracks;
  }

  /**
   * builds the events structure from the data received from the back-end
   * @param {Object} historyData data received from the back-end
   * @return {Object} new events object grouped by type
   */
  buildEventsByType(historyData) {
    // holds new history data keyed by event names
    const newHistoryData = {};

    // holds all history data in an array
    _.each(historyData, (events, event) => {
      newHistoryData[event] = _.map(events.data, (dataRow) => {
        const rowObj = {};
        let i = 0;
        _.each(events.template, (key) => {
          rowObj[key] = dataRow[i++];
          rowObj.event = event; // adding event name to the object
        });
        return rowObj;
      });
    });

    return newHistoryData;
  }

  buildDeviceOptions(devices) {
    _.each(devices, (deviceId) => {
      this.playOptions.device[deviceId] = {
        showTrail: false,
        showTracks: true,
        isFollow: true,
        noEvents: false,
      };
    });
  }

  setEventExtraAttributes(eventData) {
    let index = 0;
    _.each(eventData, (event) => {
      event.index = index++;
      event.id = event.device_id; // adding id field to the object
      event.show = true;
    });
  }

  buildSortedAllEvents(eventData) {
    let allEvents = [];
    _.each(eventData, (events) => {
      allEvents = _.concat(allEvents, events);
    });

    var sortAllEvents = _.sortBy(allEvents, "event_timestamp");

    var newAllEvents = [];
    _.each(sortAllEvents, (value, key) => {
      // Remove the first event if the event took place BEFORE the start date
      if (key == 0 && this.checkDates(value.event_timestamp)) return;
      newAllEvents.push(value);
    });
    return newAllEvents;
    //return _.sortBy(allEvents, "event_timestamp");
  }

  // Checks the first event timestamp with the users selected start date and return true/false
  checkDates(event) {
    var start = moment(this.queryParams.startTimestamp).unix();
    if (start > event) {
      return true;
    } else {
      return false;
    }
  }

  buildKeyedReports(eventData) {
    const reportData = _.keyBy(eventData.report, "report_id");
    return reportData;
  }

  get() {
    return this._allEvents;
  }

  getReportById(reportId) {
    return this._reportsById[reportId];
  }

  getEventByTimestamp(timestamp) {
    return this._eventsByTimestamp[timestamp];
  }

  getCurrentEvent() {
    return this.currentEvent;
  }

  getEventsByType(type) {
    return this._eventsByType[type];
  }

  isDeviceTrailOn(deviceId) {
    return (
      this.playOptions.device[deviceId] &&
      this.playOptions.device[deviceId].showTrail
    );
  }

  getFollowedDevices() {
    return _.reduce(
      this.playOptions.device,
      (result, options, deviceId) => {
        if (options.isFollow) return _.concat(result, deviceId);

        return result;
      },
      []
    );
  }

  /**
   * gets the next event in the list of events based on current progress
   * @param {Boolean} noProgress prevent updating progress records if set to true
   * @return {Object} the next event
   */
  getNextEvent(noProgress) {
    const nextIndex = this._progress.length;

    // if index out of bound
    if (nextIndex >= this._allEvents.length) return null;

    const nextEvent = this._allEvents[nextIndex];

    if (nextEvent && !noProgress) {
      this._progress.push(nextEvent);
      this.currentEvent = nextEvent;
    }
    return nextEvent;
  }

  /**
   * returns the next report event
   * @param {Boolean} skipHidden whether or not to skip hidden events
   * @return {Object} report event with alerts
   */
  getNextReport(skipHidden) {
    const currentTimestamp = this.currentTimestamp;

    const nextEvents = this._eventOrderByTimestamp.filter(
      (event) => event.event_timestamp > currentTimestamp
    );

    if (skipHidden) {
      return nextEvents?.find((event) => event?.show);
    }

    return nextEvents[0];
  }

  getFirstReportTimestamp() {
    return this._eventOrderByTimestamp[0]?.event_timestamp;
  }

  /**
   * returns the previous report event
   * @param {Boolean} skipHidden whether or not to skip hidden events
   * @return {Object} report event with alerts
   */
  getPreviousReport(skipHidden) {
    const currentTimestamp = this.currentTimestamp;

    const previousEvents = this._eventOrderByTimestamp.filter(
      (event) => event.event_timestamp < currentTimestamp
    );

    if (skipHidden) {
      return previousEvents?.reverse()?.find((event) => event?.show);
    }

    return previousEvents[0];
  }

  /**
   * returns the report corresponding to an event other than report
   * @param {Boolean} skipHidden whether or not to skip hidden events
   * @return {Object} report event with alerts
   */
  getNextEventReport(skipHidden) {
    const nextEvent = this.getNextEvent();

    if (!nextEvent) return null;

    // if event is report, no need to attach alert object
    if (nextEvent.event == "report") {
      // copying the alert object from the last report object so alert continues

      // skiping to the event
      this.processNextReport(nextEvent);

      if (skipHidden && !nextEvent.show)
        return this.getNextEventReport(skipHidden);

      return nextEvent;
    }

    const deviceLastReport = this.getDeviceLastReport(nextEvent.device_id);
    if (!deviceLastReport) {
      log.warn("could not find the corresponding reprot for event", nextEvent);

      return this.getNextEventReport();
    }

    deviceLastReport.alerts = deviceLastReport.alerts || {};
    const eventName = nextEvent.event;
    switch (eventName) {
      case "emergency":
      case "non_report":
        deviceLastReport.alerts[eventName] =
          deviceLastReport.alerts[eventName] || {};
        deviceLastReport.alerts[eventName].alert_started =
          nextEvent.alert_started;
        break;
      case "geofence":
      case "speed":
        deviceLastReport.alerts[eventName] =
          deviceLastReport.alerts[eventName] || {};
        deviceLastReport.alerts[eventName][nextEvent.geofence_id] =
          deviceLastReport.alerts[eventName][nextEvent.geofence_id] || {};
        deviceLastReport.alerts[eventName][
          nextEvent.geofence_id
        ].alert_started = nextEvent.alert_started;
        break;
      case "cargo":
        deviceLastReport.alerts[eventName] =
          deviceLastReport.alerts[eventName] || {};
        deviceLastReport.alerts[eventName][nextEvent.cargo_alert_type_id] =
          deviceLastReport.alerts[eventName][nextEvent.cargo_alert_type_id] ||
          {};
        deviceLastReport.alerts[eventName][
          nextEvent.cargo_alert_type_id
        ].alert_started = nextEvent.alert_started;
        break;
      case "vehicle":
        deviceLastReport.alerts[eventName] =
          deviceLastReport.alerts[eventName] || {};
        deviceLastReport.alerts[eventName][nextEvent.vehicle_alert_type_id] =
          deviceLastReport.alerts[eventName][nextEvent.vehicle_alert_type_id] ||
          {};
        deviceLastReport.alerts[eventName][
          nextEvent.vehicle_alert_type_id
        ].alert_started = nextEvent.alert_started;
        break;
      default:
        break;
    }

    // skip the hidden event if requested
    if (skipHidden && !nextEvent.show)
      return this.getNextEventReport(skipHidden);

    return deviceLastReport;
  }

  /**
   * gets the previous event object from the progress list
   * @param {Boolean} noPop whether the event object should be popped from progress objects
   * @return {Object} previous event in the progress list
   */
  getPrevEvent() {
    log.debug("getting the previous history event");
    if (!this._progress.length) return null;

    const lastEvent = this._progress.pop();
    if (lastEvent) {
      this.currentEvent = _.last(this._progress);
    }

    return lastEvent;
  }

  /**
   * gets the report event prior to the current report event
   * returns null if current event is not report or no past report is available
   * @return {Object} report event before the current report or null if does not exist
   */
  getPastReport() {
    const deviceId = this.currentEvent.device_id;
    // only returns past report if current event is report
    if (this.currentEvent.event != "report") {
      return null;
    }

    const pastReportIndex = this._progressReport[deviceId].length - 2;
    // check if a past report exists
    if (pastReportIndex < 0) return null;

    return this._progressReport[deviceId][pastReportIndex];
  }

  /**
   * gets the report corresponding to the current event
   * @return {Object} report event that corresponds to the current event
   */
  getCurrentReport() {
    const deviceId = this.currentEvent.device_id;
    return _.last(this._progressReport[deviceId]);
  }

  /**
   * returns the report event corresponding to the previous event that was played
   * @param {Boolean} skipHidden whether or not to skip hidden events
   * @return {Object} report event object
   */
  getPrevEventReport(skipHidden) {
    const prevEvent = this.getPrevEvent();
    if (!prevEvent) return null;

    if (prevEvent.event == "report") {
      const prevReport = this.processPrevReport(prevEvent);
      // skip the hidden event if requested
      if (skipHidden && !prevEvent.show)
        return this.getPrevEventReport(skipHidden);
      return prevReport;
    }

    const currReport = this.getDeviceLastReport(prevEvent.device_id);
    if (!currReport) {
      log.warn("could not find the corresponding reprot for event", prevEvent);
      // skiping to the event
      return this.getPrevEventReport();
    }
    const eventName = prevEvent.event;
    switch (eventName) {
      case "emergency":
      case "non_report":
        if (prevEvent.alert_started) {
          currReport.alerts[eventName] = null;
        } else {
          if (currReport.alerts[eventName])
            currReport.alerts[eventName].alert_started = true;
        }
        break;
      case "geofence":
      case "speed":
        if (prevEvent.alert_started) {
          currReport.alerts[eventName][prevEvent.geofence_id] = null;
        } else {
          if (
            currReport.alerts[eventName] &&
            currReport.alerts[eventName][prevEvent.geofence_id]
          ) {
            currReport.alerts[eventName][
              prevEvent.geofence_id
            ].alert_started = true;
          }
        }
        break;
      case "cargo":
        if (prevEvent.alert_started) {
          currReport.alerts[eventName][prevEvent.cargo_alert_type_id] = null;
        } else {
          if (
            currReport.alerts[eventName] &&
            currReport.alerts[eventName][prevEvent.cargo_alert_type_id]
          )
            currReport.alerts[eventName][
              prevEvent.cargo_alert_type_id
            ].alert_started = true;
        }
        break;
      case "vehicle":
        if (prevEvent.alert_started) {
          currReport.alerts[eventName][prevEvent.vehicle_alert_type_id] = null;
        } else {
          if (
            currReport.alerts[eventName] &&
            currReport.alerts[eventName][prevEvent.vehicle_alert_type_id]
          )
            currReport.alerts[eventName][
              prevEvent.vehicle_alert_type_id
            ].alert_started = true;
        }
        break;
      default:
        break;
    }

    // skip the hidden event if requested
    if (skipHidden && !prevEvent.show)
      return this.getPrevEventReport(skipHidden);

    return currReport;
  }

  /**
   * gets the alert object of the report event just before the current report event
   * @param {Object} nextEvent event object fetched
   * @return {Object} alert object of the report event
   */
  processNextReport(nextEvent) {
    const deviceId = nextEvent.device_id;

    // getting the size of the report array for the device
    this._progressReport[deviceId] = this._progressReport[deviceId] || [];
    const deviceProgressIndex = this._progressReport[deviceId].length;

    if (deviceProgressIndex > 0) {
      const lastReport =
        this._progressReport[deviceId][deviceProgressIndex - 1];
      nextEvent.alerts = _.cloneDeep(lastReport.alerts);
    }
    this._progressReport[deviceId].push(nextEvent);
    return nextEvent;
  }

  processPrevReport(prevEvent) {
    const deviceId = prevEvent.device_id;
    this._progressReport[deviceId].pop();
    return this.getDeviceLastReport(deviceId);
  }

  /**
   * gets the latest report of a device
   * @param {Number} deviceId device id
   * @return {Object} last report event object of the device
   */
  getDeviceLastReport(deviceId) {
    return _.last(this._progressReport[deviceId]);
  }

  /**
   * checks whether a device currently has an alert of given type
   * @param {Number} deviceId device id
   * @param {String} type alert type string
   * @return {Boolean} true if device has ongoing alert of the given type and false otherwise
   */
  hasAlert(report, type) {
    const deviceLastReport = report;
    switch (type) {
      case "emergency":
      case "non_report":
        return (
          deviceLastReport &&
          deviceLastReport.alerts &&
          deviceLastReport.alerts[type] &&
          deviceLastReport.alerts[type].alert_started
        );
      case "geofence":
      case "speed":
      case "vehicle":
        if (
          !(deviceLastReport && deviceLastReport.alerts) ||
          !deviceLastReport.alerts[type]
        )
          return false;
        return _.reduce(
          deviceLastReport.alerts[type],
          (result, event) => {
            return result || (event && event.alert_started);
          },
          false
        );
      case "cargo":
        if (
          !(deviceLastReport && deviceLastReport.alerts) ||
          !deviceLastReport.alerts[type]
        )
          return false;
        return _.reduce(
          deviceLastReport.alerts[type],
          (result, event) => {
            return result || (event && event.alert_started);
          },
          false
        );

      default:
        throw new Error("Wrong alert type received");
    }
  }

  hasAlertCheckForReport(report, type) {
    const deviceLastReport = report;

    switch (type) {
      case "emergency":
      case "non_report":
      case "geofence":
      case "speed":
      case "vehicle":
        return (
          deviceLastReport &&
          deviceLastReport.alerts &&
          deviceLastReport.alerts[type] &&
          deviceLastReport.alerts[type].alert_started
        );
      case "cargo":
        return (
          deviceLastReport &&
          deviceLastReport.alerts &&
          deviceLastReport.alerts[type] &&
          deviceLastReport.alerts[type].alert_started
        );
      default:
        throw new Error("Wrong alert type received");
    }
  }

  /**
   * gets latest reports that close to current timestamp that should be played for each device keyed by event names
   * @return {Array} list of report for each device
   */
  getCurrentDeviceReports(deviceId) {
    // const currentEvents = {};
    // _.each(this._progressReport, (reportEvents, deviceId) => {
    //   const lastReport = _.last(reportEvents);
    //   if (lastReport) currentEvents[deviceId] = lastReport;
    // });

    // return currentEvents;
    const currentReport = this.getFilteredReports(this.currentTimestamp);
    if (deviceId) {
      if (currentReport[deviceId] !== null) {
        return currentReport[deviceId];
      } else {
        return null;
      }
    } else {
      return currentReport;
    }
  }

  /**
   * gets latest reports that close given timestamp that should be played for each device keyed by event names
   * @return {Array} list of report for each device
   */
  getFilteredReports(timestamp) {
    const filteredReports = {};
    _.each(this._eventOrderByTimestamp, (event) => {
      if (event.event_timestamp <= timestamp) {
        if (this.getEventReport(event)) {
          let deviceReport = this.getEventReport(event);
          const alertsForThisReport = this.checkIfEventHasAlerts(
            timestamp,
            event.device_id
          );

          if (alertsForThisReport.length > 0) {
            deviceReport.alerts = {};
            alertsForThisReport.forEach((eventName, index) => {
              switch (eventName) {
                case "emergency":
                case "non_report":
                  deviceReport.alerts[eventName] =
                    deviceReport.alerts[eventName] || {};
                  deviceReport.alerts[eventName].alert_started = true;
                  break;
                case "geofence":
                case "speed":
                  deviceReport.alerts[eventName] =
                    deviceReport.alerts[eventName] || {};
                  deviceReport.alerts[eventName][index] =
                    deviceReport.alerts[eventName][index] || {};
                  deviceReport.alerts[eventName][index].alert_started = true;
                  break;
                case "cargo":
                  deviceReport.alerts[eventName] =
                    deviceReport.alerts[eventName] || {};
                  deviceReport.alerts[eventName][index] =
                    deviceReport.alerts[eventName][index] || {};
                  deviceReport.alerts[eventName][index].alert_started = true;
                  break;
                case "vehicle":
                  deviceReport.alerts[eventName] =
                    deviceReport.alerts[eventName] || {};
                  deviceReport.alerts[eventName][index] =
                    deviceReport.alerts[eventName][index] || {};
                  deviceReport.alerts[eventName][index].alert_started = true;
                  deviceReport.alerts[eventName][index].vehicleTypeId =
                    event.vehicle_alert_type_id;
                  break;
                default:
                  break;
              }
            });
          }

          deviceReport.event_timestamp = event.event_timestamp;

          filteredReports[event.device_id] = deviceReport;
        }
      }
    });

    return filteredReports;
  }

  getAllReports() {
    return _.filter(this._allEvents, (e) => e.event === "report");
  }

  /**
   * transfer event to report by event.report_id
   * @return {object} report object
   */
  getEventReport(event) {
    const reports = this.getAllReports();

    if (event.report_id) {
      return _.find(reports, (report) => report.report_id === event.report_id);
    }
  }

  /**
   * gets all but last device reports from the progress object
   *
   */
  getPastDeviceReports() {
    const pastEvents = {};
    _.each(this._progressReport, (reportEvents, deviceId) => {
      if (reportEvents) pastEvents[deviceId] = reportEvents;
    });
    return pastEvents;
  }

  /**
   * plays the history forward or backward based on given timestamp and current timestamp
   * @param {Number} toTimestamp timestamp to play the history to
   */
  fastPlayTo() {
    return true;
  }
  // fastPlayTo(toTimestamp) {
  //   let currentEventTimestamp =
  //     (this.currentEvent && this.currentEvent.event_timestamp) || 0;
  //   if (toTimestamp > currentEventTimestamp) {
  //     let nextEvent = this.getNextEventReport();
  //     while (nextEvent && nextEvent.event_timestamp <= toTimestamp) {
  //       nextEvent = this.getNextEventReport();
  //     }
  //     // putting an extra item back in the event list
  //     this.getPrevEventReport();
  //   } else if (toTimestamp < currentEventTimestamp) {
  //     let prevEvent = this.getPrevEventReport();
  //     while (prevEvent && prevEvent.event_timestamp >= toTimestamp) {
  //       prevEvent = this.getPrevEventReport();
  //     }
  //     // putting an extra item back in the event list
  //     //this.getNextEventReport();
  //   }
  // }

  /**
   * returns adjacent event to the currently playing event
   * @param {Number} len number of adjacent events to get
   * @return {Array} list of events adjacent to current event
   */
  getAdjacentEvents(len) {
    len = len || 5; // set default length
    const result = [];
    if (!this.currentEvent) return result;

    const currTimestamp = this.currentEvent.event_timestamp;

    // get the event index
    const index = _.sortedIndexBy(
      this._allEvents,
      { event_timestamp: currTimestamp },
      "event_timestamp"
    );

    const eventLen = this._allEvents.length;
    for (let i = -len; i < len; ++i) {
      // check if index is not out of bound
      if (index + i < 0 || index + i > eventLen - 1) continue;

      result.push(this._allEvents[index + i]);
    }
    return result;
  }

  openWindow(pageUrl) {
    const GuiUtils = require("sccGuiUtils").default;
    if (!pageUrl) {
      // to prevent loading a previously loaded asset when window opens
      this.selectedAssetId = null;
      this.selectedAssetName = null;
    }

    var url = "";
    if (typeof pageUrl != "undefined") {
      url = pageUrl;
    }

    if (typeof this.openWindow.windowRefs == "undefined") {
      this.openWindow.windowRefs = {};
    }
    if (
      typeof this.openWindow.windowRefs["History"] == "undefined" ||
      this.openWindow.windowRefs["History"].closed
    ) {
      this.openWindow.windowRefs["History"] = GuiUtils.openPopupWindow(
        this.pageUrl + url,
        "History"
      );
    } else {
      this.openWindow.windowRefs["History"].focus();
    }
  }

  /**
   * closes the history window
   */
  closeWindow() {
    var winRef = window.open("", "History", "", true);
    if (winRef != null) {
      winRef.close();
    }
  }

  /**
   * Opens a new History window and loads the asset with the given iMEi
   */
  openWindowLoadDevice(deviceId) {
    this.openWindow("?deviceId=" + deviceId);
  }

  displayTrailVehicleEvents(report) {
    let eventToArray = [];
    if (!_.isUndefined(report?.alerts)) {
      _.each(report.alerts.vehicle, (value, key) => {
        if (value?.alert_started) {
          eventToArray.push(
            Alert.getVehicleAlertType(value.vehicleTypeId).type
          );
        }
      });
      if (eventToArray.length === 0) return "N/A"; ////exit when no vehicle events have been triggered
      return eventToArray.toString();
    }
    return "N/A"; ////exit when no vehicle events have been triggered
  }

  displayTrailVehicleAlerts(report) {
    let eventToArray = [];
    // Filter Emergency alerts by selected timestamp
    var alerts = _.filter(this._eventsByTypeMaster.emergency, {
      event_timestamp: report?.event_timestamp,
    });

    if (!_.isUndefined(report?.alerts)) {
      _.each(alerts, (value) => {
        if (value.vehicleTypeId) {
          if (value.vehicle_alert_type_id)
            eventToArray.push(
              Alert.getVehicleAlertType(value.vehicleTypeId).type
            );
          else eventToArray.push("Emergency");
        }
      });
      if (eventToArray.length === 0) return "N/A"; ////exit when no vehicle events have been triggered
      return eventToArray.toString();
    }
    return "N/A"; ////exit when no vehicle events have been triggered
  }

  /**
   * clears Data and Structure
   */
  clearStructures() {
    this._eventsByType = {};
    this._eventsByTypeMaster = {};
    this._allEvents = [];
    this._reportsById = {};
    this._eventsByTimestamp = {};
    this._eventOrderByTimestamp = {};
    this._progress = [];
    this._progressReport = {};
    this.currentTimestamp = 0;
    this.playSpeed = 1;
    this.currentEvent = null;
    this.playOptions = {
      event: {
        emergency: true,
        speed: true,
        geofence: true,
        cargo: true,
        non_report: true,
        report: true,
        vehicle: true,
      },
      device: {},
      autoSkip: true,
    };
  }
}

//module.exports= New Historic();
export default new Historic();
