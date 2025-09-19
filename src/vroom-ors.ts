import { ORSClient } from './ors-client.js';
import polyline from '@mapbox/polyline';
import {
  Coordinate,
  ORSDirectionsOptions,
  VroomProblem,
  VroomSolution,
  VroomShipment,
  MatrixEntry
} from './types.js';

export class VroomORS {
  private orsClient: ORSClient;
  private vroomEndpoint: string;

  constructor(orsApiKey: string, vroomEndpoint: string = 'http://localhost:3000', orsBaseUrl?: string) {
    this.orsClient = new ORSClient(orsApiKey, orsBaseUrl);
    this.vroomEndpoint = vroomEndpoint;
  }

  async solve(problem: VroomProblem, orsOptions: ORSDirectionsOptions = {}): Promise<VroomSolution> {
    const locations = this.extractLocations(problem);

    const matrixEntries = await this.orsClient.createMatrix(
      locations.map(loc => ({ lat: loc[1], lng: loc[0] })),
      orsOptions
    );

    const { durations, distances } = this.convertMatrixEntriesToMatrices(matrixEntries, locations.length);

    // Store geometries for route reconstruction
    const geometryMap = new Map<string, string>();
    for (const entry of matrixEntries) {
      if (entry.geometry) {
        geometryMap.set(`${entry.from}-${entry.to}`, entry.geometry);
      }
    }

    const profile = orsOptions.profile || 'driving-car';

    // Convert locations to indices for matrix-based problem
    const problemWithMatrix: VroomProblem = {
      ...problem,
      jobs: problem.jobs.map(job => {
        if (!job.location) {
          throw new Error(`Job ${job.id} must have a location when using matrix-based routing`);
        }
        const { location, ...jobWithoutLocation } = job;
        return {
          ...jobWithoutLocation,
          location_index: this.mapLocationToIndex(location, locations)
        };
      }),
      shipments: problem.shipments?.map(shipment => {
        const convertedShipment: VroomShipment = { ...shipment };

        if (shipment.pickup?.location) {
          const { location, ...pickupWithoutLocation } = shipment.pickup;
          convertedShipment.pickup = {
            ...pickupWithoutLocation,
            location_index: this.mapLocationToIndex(location, locations)
          };
        }

        if (shipment.delivery?.location) {
          const { location, ...deliveryWithoutLocation } = shipment.delivery;
          convertedShipment.delivery = {
            ...deliveryWithoutLocation,
            location_index: this.mapLocationToIndex(location, locations)
          };
        }

        return convertedShipment;
      }),
      vehicles: problem.vehicles.map(vehicle => {
        const { start, end, ...vehicleWithoutLocations } = vehicle;
        return {
          ...vehicleWithoutLocations,
          profile: vehicle.profile || profile, // Use vehicle's profile or default to the matrix profile
          start_index: vehicle.start ? this.mapLocationToIndex(vehicle.start, locations) : undefined,
          end_index: vehicle.end ? this.mapLocationToIndex(vehicle.end, locations) : undefined
        };
      }),
      matrices: {
        [profile]: {
          durations,
          distances
        }
      }
    };

    console.log('Problem with matrix:', JSON.stringify(problemWithMatrix, null, 2));

    const response = await fetch(this.vroomEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(problemWithMatrix)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VROOM API error: ${response.status} - ${errorText}`);
    }

    const solution: VroomSolution = await response.json();

    // Add geometry to routes
    if (solution.routes) {
      for (const route of solution.routes) {
        if (route.steps && route.steps.length > 1) {
          const routeGeometries: string[] = [];

          for (let i = 0; i < route.steps.length - 1; i++) {
            const currentStep = route.steps[i];
            const nextStep = route.steps[i + 1];

            // Get location indices directly from VROOM steps
            const fromIndex = currentStep.location_index;
            const toIndex = nextStep.location_index;

            if (fromIndex != null && toIndex != null) {
              const geometry = geometryMap.get(`${fromIndex}-${toIndex}`);
              if (geometry) {
                routeGeometries.push(geometry);
              }
            }
          }

          // Add geometry to route (combine all segments)
          if (routeGeometries.length > 0) {
            console.log(`Combining ${routeGeometries.length} geometry segments for route`);

            try {
              // Decode all polylines to coordinate arrays
              const decodedSegments: [number, number][][] = [];
              for (const geom of routeGeometries) {
                if (geom && geom.length > 0) {
                  const coordinates = polyline.decode(geom);
                  decodedSegments.push(coordinates);
                }
              }

              if (decodedSegments.length > 0) {
                // Combine all coordinates into a single array
                const combinedCoordinates: [number, number][] = [];

                for (let i = 0; i < decodedSegments.length; i++) {
                  const segment = decodedSegments[i];
                  if (i === 0) {
                    // Add all points from first segment
                    combinedCoordinates.push(...segment);
                  } else {
                    // Skip first point of subsequent segments (it's the same as last point of previous)
                    combinedCoordinates.push(...segment.slice(1));
                  }
                }

                // Encode the combined coordinates back to polyline
                const combinedPolyline = polyline.encode(combinedCoordinates);
                (route as any).geometry = combinedPolyline;

                console.log(`Combined route geometry: ${combinedCoordinates.length} points -> ${combinedPolyline.substring(0, 50)}...`);
              }
            } catch (error) {
              console.warn('Failed to combine polylines:', error);
              // Fallback to first valid geometry
              const validGeometry = routeGeometries.find(g => g && g.length > 0);
              if (validGeometry) {
                (route as any).geometry = validGeometry;
              }
            }
          }
        }
      }
    }

    return solution;
  }

  private extractLocations(problem: VroomProblem): Array<[number, number]> {
    const locations: Array<[number, number]> = [];
    const locationSet = new Set<string>();

    for (const job of problem.jobs) {
      if (job.location) {
        const locationKey = `${job.location[0]},${job.location[1]}`;
        if (!locationSet.has(locationKey)) {
          locations.push(job.location);
          locationSet.add(locationKey);
        }
      }
    }

    // Extract locations from shipments
    if (problem.shipments) {
      for (const shipment of problem.shipments) {
        if (shipment.pickup?.location) {
          const pickupKey = `${shipment.pickup.location[0]},${shipment.pickup.location[1]}`;
          if (!locationSet.has(pickupKey)) {
            locations.push(shipment.pickup.location);
            locationSet.add(pickupKey);
          }
        }
        if (shipment.delivery?.location) {
          const deliveryKey = `${shipment.delivery.location[0]},${shipment.delivery.location[1]}`;
          if (!locationSet.has(deliveryKey)) {
            locations.push(shipment.delivery.location);
            locationSet.add(deliveryKey);
          }
        }
      }
    }

    for (const vehicle of problem.vehicles) {
      if (vehicle.start) {
        const startKey = `${vehicle.start[0]},${vehicle.start[1]}`;
        if (!locationSet.has(startKey)) {
          locations.push(vehicle.start);
          locationSet.add(startKey);
        }
      }
      if (vehicle.end) {
        const endKey = `${vehicle.end[0]},${vehicle.end[1]}`;
        if (!locationSet.has(endKey)) {
          locations.push(vehicle.end);
          locationSet.add(endKey);
        }
      }
    }

    return locations;
  }

  private convertMatrixEntriesToMatrices(
    entries: MatrixEntry[],
    size: number
  ): { durations: number[][]; distances: number[][] } {
    const durations: number[][] = Array(size).fill(null).map(() => Array(size).fill(0));
    const distances: number[][] = Array(size).fill(null).map(() => Array(size).fill(0));

    for (const entry of entries) {
      // Handle null/undefined values by using large but finite numbers
      const duration = (entry.duration == null || !isFinite(entry.duration)) ? 999999 : Math.round(entry.duration);
      const distance = (entry.distance == null || !isFinite(entry.distance)) ? 999999000 : Math.round(entry.distance * 1000);

      durations[entry.from][entry.to] = duration;
      distances[entry.from][entry.to] = distance;
    }

    return { durations, distances };
  }

  private mapLocationToIndex(
    location: [number, number],
    locations: Array<[number, number]>
  ): number {
    for (let i = 0; i < locations.length; i++) {
      if (locations[i][0] === location[0] && locations[i][1] === location[1]) {
        return i;
      }
    }
    throw new Error(`Location [${location[0]}, ${location[1]}] not found in locations array`);
  }

  private findLocationIndex(
    step: any,
    locations: Array<[number, number]>,
    problem: VroomProblem
  ): number {
    // For start/end steps, find vehicle's start/end location
    if (step.type === 'start' || step.type === 'end') {
      const vehicle = problem.vehicles.find(v => v.id === step.vehicle);
      if (vehicle) {
        const vehicleLocation = step.type === 'start' ? vehicle.start : vehicle.end;
        if (vehicleLocation) {
          return this.mapLocationToIndex(vehicleLocation, locations);
        }
      }
    }

    // For job steps, find job's location
    if (step.type === 'job' && step.id) {
      const job = problem.jobs.find(j => j.id === step.id);
      if (job?.location) {
        return this.mapLocationToIndex(job.location, locations);
      }
    }

    // For pickup/delivery steps (shipments)
    if ((step.type === 'pickup' || step.type === 'delivery') && step.id) {
      const shipment = problem.shipments?.find(s =>
        s.pickup?.id === step.id || s.delivery?.id === step.id
      );
      if (shipment) {
        const location = step.type === 'pickup' ? shipment.pickup?.location : shipment.delivery?.location;
        if (location) {
          return this.mapLocationToIndex(location, locations);
        }
      }
    }

    return -1; // Not found
  }

  async getMatrix(
    locations: Coordinate[],
    options: ORSDirectionsOptions = {}
  ): Promise<{ durations: number[][]; distances: number[][] }> {
    const matrixEntries = await this.orsClient.createMatrix(locations, options);
    return this.convertMatrixEntriesToMatrices(matrixEntries, locations.length);
  }
}