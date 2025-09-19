export interface Coordinate {
  lat: number;
  lng: number;
}

export interface ORSDirectionsOptions {
  profile?: 'driving-car' | 'driving-hgv' | 'cycling-regular' | 'cycling-road' | 'cycling-mountain' | 'cycling-electric' | 'foot-walking' | 'foot-hiking' | 'wheelchair' | 'public-transport';
  preference?: 'fastest' | 'shortest' | 'recommended' | 'custom';
  format?: 'json' | 'geojson';
  units?: 'km' | 'mi' | 'm';
  geometry?: boolean;
  instructions?: boolean;
  instructions_format?: 'html' | 'text';
  elevation?: boolean;
  extra_info?: string[];
  maximum_speed?: number;
  options?: {
    avoid_features?: string[];
    avoid_borders?: 'all' | 'controlled' | 'none';
    avoid_countries?: string[];
    vehicle_type?: 'hgv' | 'bus' | 'agricultural' | 'delivery' | 'forestry' | 'goods' | 'unknown';
    [key: string]: any;
  };
}

export interface ORSDirectionsResponse {
  routes: Array<{
    summary: {
      distance: number;
      duration: number;
    };
    segments: Array<{
      distance: number;
      duration: number;
      steps: any[];
    }>;
    geometry?: any;
    way_points?: number[];
  }>;
  bbox?: number[];
  info?: {
    attribution: string;
    service: string;
    timestamp: number;
    query: any;
    engine: any;
  };
}

export interface MatrixEntry {
  from: number; // index of the origin
  to: number; // index of the destination
  distance: number; // in meters
  duration: number; // in seconds
  geometry?: string; // Encoded polyline geometry
}

export interface VroomJob {
  id: number;
  description?: string; // a string describing this job
  location?: [number, number]; // [longitude, latitude]
  location_index?: number; // For matrix-based problems
  setup?: number; // task setup duration (defaults to 0)
  service?: number; // task service duration (defaults to 0)
  delivery?: number[]; // for multi-dimensional demands
  pickup?: number[]; // for multi-dimensional supplies
  skills?: number[]; // an array of integers defining mandatory skills
  priority?: number; // An integer in the range 0..100 describing the priority level (default 0)
  time_windows?: Array<[number, number]>; // an array of time_window objects describing valid slots for task service start
}

export interface VroomShipment {
  id: number;
  pickup?: {
    id?: number;
    description?: string; // a string describing this step
    location?: [number, number]; // [longitude, latitude]
    location_index?: number; // For matrix-based problems
    setup?: number; // task setup duration (defaults to 0)
    service?: number; // task service duration (defaults to 0)
    time_windows?: Array<[number, number]>; // an array of time_window objects describing valid slots for task service start
  };
  delivery?: {
    id?: number;
    description?: string; // a string describing this step
    location?: [number, number]; // [longitude, latitude]
    location_index?: number; // For matrix-based problems
    setup?: number; // task setup duration (defaults to 0)
    service?: number; // task service duration (defaults to 0)
    time_windows?: Array<[number, number]>; // an array of time_window objects describing valid slots for task service start
  };
  amount?: number[]; // an array of integers describing multidimensional quantities
  skills?: number[]; // an array of integers defining mandatory skills
  priority?: number; // An integer in the range 0..100 describing the priority level (default 0)
}

export interface VroomVehicle {
  id: number;
  profile?: string;
  description?: string; // a string describing this vehicle
  type?: string; // a string describing the vehicle type
  start?: [number, number]; // [longitude, latitude]
  end?: [number, number]; // [longitude, latitude]
  start_index?: number; // For matrix-based problems
  end_index?: number; // For matrix-based problems
  capacity?: number[]; // an array of integers describing multidimensional capacities
  skills?: number[]; // an array of integers defining vehicle skills
  time_window?: [number, number]; // a time_window object describing valid vehicle operation times
  breaks?: Array<{
    id: number;
    time_windows: Array<[number, number]>;
    service?: number;
  }>;
  costs?: {
    fixed?: number; // fixed cost per vehicle (defaults to 0)
    per_hour?: number; // cost per hour of vehicle usage (defaults to 3600)
    per_km?: number; // cost per km of vehicle usage (defaults to 0)
  }
}

export interface VroomOptions {
  g?: boolean;
}

export interface VroomProblem {
  jobs: VroomJob[];
  shipments?: VroomShipment[];
  vehicles: VroomVehicle[];
  options?: VroomOptions;
  matrices?: {
    [profile: string]: {
      durations?: number[][];
      distances?: number[][];
      costs?: number[][];
    };
  };
}

export interface VroomSolution {
  code: number;
  summary: {
    cost: number;
    routes: number;
    unassigned: number;
    setup: number;
    service: number;
    duration: number;
    waiting_time: number;
    priority: number;
    distance?: number;
    computing_times: {
      loading: number;
      solving: number;
      routing: number;
    };
  };
  unassigned: Array<{
    id: number;
    location: [number, number];
    reason: string;
  }>;
  routes: Array<{
    vehicle: number;
    cost: number;
    setup: number;
    service: number;
    duration: number;
    waiting_time: number;
    priority: number;
    distance?: number;
    geometry?: string; // Encoded polyline geometry for the complete route
    steps: Array<{
      type: 'start' | 'job' | 'end' | 'pickup' | 'delivery';
      location?: [number, number];
      location_index?: number;
      id?: number;
      setup?: number;
      service?: number;
      waiting_time?: number;
      arrival?: number;
      duration?: number;
      distance?: number;
    }>;
  }>;
}