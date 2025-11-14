import { useState, useEffect } from 'react';
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/animate-ui/components/radix/alert-dialog';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";

// Type for delete confirmation state
type DeleteConfirmation = {
  type: 'device' | 'location' | 'alarm';
  id: number;
  name?: string;
} | null;

const Settings: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showAlarmModal, setShowAlarmModal] = useState(false);
  
  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmation>(null);

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
      alert('Failed to load data. Please refresh the page.');
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

  const handleDeleteDevice = (id: number, name: string) => {
    setDeleteConfirm({ type: 'device', id, name });
  };

  const handleDeleteLocation = (id: number) => {
    setDeleteConfirm({ type: 'location', id });
  };

  const handleDeleteAlarm = (id: number) => {
    setDeleteConfirm({ type: 'alarm', id });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      switch (deleteConfirm.type) {
        case 'device':
          await deleteDevice(deleteConfirm.id, deleteConfirm.name || '');
          break;
        case 'location':
          await deleteLocation(deleteConfirm.id);
          break;
        case 'alarm':
          await deleteAlarm(deleteConfirm.id);
          break;
      }
      loadData();
    } catch (err) {
      console.error(`Failed to delete ${deleteConfirm.type}:`, err);
      alert(`Failed to delete ${deleteConfirm.type}`);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const getDeleteMessage = () => {
    if (!deleteConfirm) return '';
    
    switch (deleteConfirm.type) {
      case 'device':
        return `Are you sure you want to delete device ${deleteConfirm.name}?`;
      case 'location':
        return 'Are you sure you want to delete this location?';
      case 'alarm':
        return 'Are you sure you want to delete this alarm?';
    }
  };

  if (loading) {
    return (
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
          <p className="text-muted-foreground">
            Manage devices, locations, and temperature alarms
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {/* Locations Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle>Device Locations</CardTitle>
              <CardDescription>Manage physical locations for temperature sensors</CardDescription>
            </div>
            <Button onClick={() => setShowLocationModal(true)} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Location
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Shortcode</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No locations configured. Add your first location to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  locations.map((location) => (
                    <TableRow key={location.ID}>
                      <TableCell className="font-medium">{location.NAME}</TableCell>
                      <TableCell>{location.SHORTCODE}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteLocation(location.ID)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Alarms Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle>Temperature Alarms</CardTitle>
              <CardDescription>Configure email alerts for temperature thresholds</CardDescription>
            </div>
            <Button onClick={() => setShowAlarmModal(true)} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Alarm
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alarms.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No alarms configured. Add an alarm to receive notifications.
                    </TableCell>
                  </TableRow>
                ) : (
                  alarms.map((alarm) => (
                    <TableRow key={alarm.ID}>
                      <TableCell className="font-medium">{alarm.EMAIL}</TableCell>
                      <TableCell>{alarm.TEMP}°F</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteAlarm(alarm.ID)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Devices Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle>Temperature Devices</CardTitle>
              <CardDescription>Manage registered NodeMCU temperature sensors</CardDescription>
            </div>
            <Button onClick={() => setShowDeviceModal(true)} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Device
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Campus</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No devices registered. Add your first device to start monitoring.
                    </TableCell>
                  </TableRow>
                ) : (
                  devices.map((device) => (
                    <TableRow key={device.ID}>
                      <TableCell className="font-medium">{device.Name}</TableCell>
                      <TableCell>{device.Campus}</TableCell>
                      <TableCell>{device.Location}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteDevice(device.ID, device.Name)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Add Device Dialog */}
      <Dialog open={showDeviceModal} onOpenChange={setShowDeviceModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Device</DialogTitle>
            <DialogDescription>
              Register a new temperature monitoring device.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddDevice}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="device-name">Name</Label>
                <Input
                  id="device-name"
                  value={deviceForm.name}
                  onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })}
                  placeholder="Enter device name"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="device-campus">Campus</Label>
                <Input
                  id="device-campus"
                  value={deviceForm.campus}
                  onChange={(e) => setDeviceForm({ ...deviceForm, campus: e.target.value })}
                  placeholder="Enter campus/building"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="device-location">Location</Label>
                <Input
                  id="device-location"
                  value={deviceForm.location}
                  onChange={(e) => setDeviceForm({ ...deviceForm, location: e.target.value })}
                  placeholder="Enter specific location"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDeviceModal(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Device</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Location Dialog */}
      <Dialog open={showLocationModal} onOpenChange={setShowLocationModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
            <DialogDescription>
              Create a new location for organizing devices.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddLocation}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="location-name">Name</Label>
                <Input
                  id="location-name"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                  placeholder="Enter location name"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="location-shortcode">Shortcode</Label>
                <Input
                  id="location-shortcode"
                  value={locationForm.shortcode}
                  onChange={(e) => setLocationForm({ ...locationForm, shortcode: e.target.value })}
                  placeholder="Enter shortcode (e.g., NYC, LA)"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowLocationModal(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Location</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Alarm Dialog */}
      <Dialog open={showAlarmModal} onOpenChange={setShowAlarmModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Alarm</DialogTitle>
            <DialogDescription>
              Configure an email alert for temperature threshold monitoring.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAlarm}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="alarm-email">Email</Label>
                <Input
                  id="alarm-email"
                  type="email"
                  value={alarmForm.email}
                  onChange={(e) => setAlarmForm({ ...alarmForm, email: e.target.value })}
                  placeholder="Enter email address"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="alarm-temp">Temperature Threshold (°F)</Label>
                <Input
                  id="alarm-temp"
                  type="number"
                  value={alarmForm.temp}
                  onChange={(e) => setAlarmForm({ ...alarmForm, temp: e.target.value })}
                  placeholder="Enter temperature"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAlarmModal(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Alarm</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation AlertDialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent from="bottom" className="sm:max-w-[425px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              {getDeleteMessage()} This action cannot be undone. This will permanently delete the data from the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Settings;