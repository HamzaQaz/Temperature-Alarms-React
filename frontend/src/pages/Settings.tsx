import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getDevices,
  getLocations,
  getAlarms,
  addDevice,
  addLocation,
  addAlarm,
  deleteDevice,
  deleteLocation,
  deleteAlarm
} from '../api';
import type { Device, Location, Alarm } from '../types';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showAlarmModal, setShowAlarmModal] = useState(false);

  // Form states
  const [deviceForm, setDeviceForm] = useState({ name: '', campus: '', location: '' });
  const [locationForm, setLocationForm] = useState({ name: '', shortcode: '' });
  const [alarmForm, setAlarmForm] = useState({ email: '', temp: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [devicesData, locationsData, alarmsData] = await Promise.all([
        getDevices(),
        getLocations(),
        getAlarms()
      ]);
      setDevices(devicesData);
      setLocations(locationsData);
      setAlarms(alarmsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDevice(deviceForm.name, deviceForm.campus, deviceForm.location);
      setDeviceForm({ name: '', campus: '', location: '' });
      setShowDeviceModal(false);
      loadData();
    } catch (err) {
      console.error('Failed to add device:', err);
      alert('Failed to add device');
    }
  };

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addLocation(locationForm.name, locationForm.shortcode);
      setLocationForm({ name: '', shortcode: '' });
      setShowLocationModal(false);
      loadData();
    } catch (err) {
      console.error('Failed to add location:', err);
      alert('Failed to add location');
    }
  };

  const handleAddAlarm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addAlarm(alarmForm.email, parseInt(alarmForm.temp));
      setAlarmForm({ email: '', temp: '' });
      setShowAlarmModal(false);
      loadData();
    } catch (err) {
      console.error('Failed to add alarm:', err);
      alert('Failed to add alarm');
    }
  };

  const handleDeleteDevice = async (id: number, name: string) => {
    if (window.confirm(`Are you sure you want to delete device ${name}?`)) {
      try {
        await deleteDevice(id, name);
        loadData();
      } catch (err) {
        console.error('Failed to delete device:', err);
        alert('Failed to delete device');
      }
    }
  };

  const handleDeleteLocation = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this location?')) {
      try {
        await deleteLocation(id);
        loadData();
      } catch (err) {
        console.error('Failed to delete location:', err);
        alert('Failed to delete location');
      }
    }
  };

  const handleDeleteAlarm = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this alarm?')) {
      try {
        await deleteAlarm(id);
        loadData();
      } catch (err) {
        console.error('Failed to delete alarm:', err);
        alert('Failed to delete alarm');
      }
    }
  };

  if (loading) {
    return <div className="text-center mt-5">Loading...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="jumbotron jumbotron-fluid bg-light" style={{ marginBottom: 0, paddingBottom: '5px' }}>
        <h1 style={{ display: 'inline', marginLeft: '20px', float: 'left' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
            <i className="fas fa-chevron-left"></i>
          </a>
        </h1>
        <h1 style={{ textAlign: 'center', marginBottom: 0 }}>Settings</h1>
        <br />
        <br />
      </div>

      {/* Locations Section */}
      <div className="container mt-4">
        <h4 style={{ textAlign: 'center' }}>Device Locations</h4>
        <table className="table table-sm" style={{ margin: '0px auto', textAlign: 'center', tableLayout: 'auto', width: 'auto' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Shortcode</th>
              <th>
                <button
                  onClick={() => setShowLocationModal(true)}
                  className="btn btn-link p-0"
                  style={{ color: 'green' }}
                >
                  <i className="fas fa-plus"></i>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 ? (
              <tr>
                <td colSpan={3}>No locations available.</td>
              </tr>
            ) : (
              locations.map((location) => (
                <tr key={location.ID}>
                  <td>{location.NAME}</td>
                  <td>{location.SHORTCODE}</td>
                  <td>
                    <button
                      onClick={() => handleDeleteLocation(location.ID)}
                      className="btn btn-link p-0"
                      style={{ color: 'red' }}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <hr />

        {/* Alarms Section */}
        <h4 style={{ textAlign: 'center' }}>Temperature Alarms</h4>
        <table className="table table-sm" style={{ margin: '0px auto', textAlign: 'center', tableLayout: 'auto', width: 'auto' }}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Temperature</th>
              <th>
                <button
                  onClick={() => setShowAlarmModal(true)}
                  className="btn btn-link p-0"
                  style={{ color: 'green' }}
                >
                  <i className="fas fa-plus"></i>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {alarms.length === 0 ? (
              <tr>
                <td colSpan={3}>No alarms available.</td>
              </tr>
            ) : (
              alarms.map((alarm) => (
                <tr key={alarm.ID}>
                  <td>{alarm.EMAIL}</td>
                  <td>{alarm.TEMP}</td>
                  <td>
                    <button
                      onClick={() => handleDeleteAlarm(alarm.ID)}
                      className="btn btn-link p-0"
                      style={{ color: 'red' }}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <hr />

        {/* Devices Section */}
        <h4 style={{ textAlign: 'center' }}>Temperature Devices</h4>
        <table className="table table-sm" style={{ margin: '0px auto', textAlign: 'center', tableLayout: 'auto', width: 'auto' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Shortcode</th>
              <th>Location</th>
              <th>
                <button
                  onClick={() => setShowDeviceModal(true)}
                  className="btn btn-link p-0"
                  style={{ color: 'green' }}
                >
                  <i className="fas fa-plus"></i>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={4}>No devices available.</td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.ID}>
                  <td>{device.Name}</td>
                  <td>{device.Campus}</td>
                  <td>{device.Location}</td>
                  <td>
                    <button
                      onClick={() => handleDeleteDevice(device.ID, device.Name)}
                      className="btn btn-link p-0"
                      style={{ color: 'red' }}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Device Modal */}
      {showDeviceModal && (
        <div className="modal show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add Device</h5>
                <button onClick={() => setShowDeviceModal(false)} className="close">
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleAddDevice}>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={deviceForm.name}
                      onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Campus</label>
                    <input
                      type="text"
                      className="form-control"
                      value={deviceForm.campus}
                      onChange={(e) => setDeviceForm({ ...deviceForm, campus: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Location</label>
                    <input
                      type="text"
                      className="form-control"
                      value={deviceForm.location}
                      onChange={(e) => setDeviceForm({ ...deviceForm, location: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" onClick={() => setShowDeviceModal(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add Location Modal */}
      {showLocationModal && (
        <div className="modal show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add Location</h5>
                <button onClick={() => setShowLocationModal(false)} className="close">
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleAddLocation}>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={locationForm.name}
                      onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Shortcode</label>
                    <input
                      type="text"
                      className="form-control"
                      value={locationForm.shortcode}
                      onChange={(e) => setLocationForm({ ...locationForm, shortcode: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" onClick={() => setShowLocationModal(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add Alarm Modal */}
      {showAlarmModal && (
        <div className="modal show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add Alarm</h5>
                <button onClick={() => setShowAlarmModal(false)} className="close">
                  <span>&times;</span>
                </button>
              </div>
              <form onSubmit={handleAddAlarm}>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email"
                      className="form-control"
                      value={alarmForm.email}
                      onChange={(e) => setAlarmForm({ ...alarmForm, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Temperature</label>
                    <input
                      type="number"
                      className="form-control"
                      value={alarmForm.temp}
                      onChange={(e) => setAlarmForm({ ...alarmForm, temp: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" onClick={() => setShowAlarmModal(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
