import React, {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { NativeModules, requireNativeComponent } from 'react-native';
import type { Position } from 'geojson';
import type {
  CameraAnimationMode,
  UserTrackingMode,
  UserTrackingModeChangeCallback,
} from 'types/Camera';

import geoUtils from '../utils/geoUtils';

const NativeModule = NativeModules.MGLModule;

const nativeAnimationMode = (
  mode?: CameraAnimationMode,
): NativeAnimationMode => {
  const NativeCameraModes = NativeModule.CameraModes;

  switch (mode) {
    case CameraModes.Flight:
      return NativeCameraModes.Flight;
    case CameraModes.Ease:
      return NativeCameraModes.Ease;
    case CameraModes.Linear:
      return NativeCameraModes.Linear;
    case CameraModes.Move:
      return NativeCameraModes.Move;
    case CameraModes.None:
      return NativeCameraModes.Move;
    default:
      return NativeCameraModes.Ease;
  }
};

export const NATIVE_MODULE_NAME = 'RCTMGLCamera';

const CameraModes: Record<string, CameraAnimationMode> = {
  Flight: 'flyTo',
  Ease: 'easeTo',
  Linear: 'linearTo',
  Move: 'moveTo',
  None: 'none',
};

export const UserTrackingModes: Record<string, UserTrackingMode> = {
  Follow: 'normal',
  FollowWithHeading: 'compass',
  FollowWithCourse: 'course',
};

// Component types.

export interface CameraProps
  extends CameraStop,
    CameraFollowConfig,
    CameraMinMaxConfig {
  /** The configuration that the camera falls back on, if no other values are specified. */
  defaultSettings?: CameraStop;
  /** Whether the camera should send any configuration to the native module. Prevents unnecessary tile
   * fetching and improves performance when the map is not visible. Defaults to `true`. (Not yet implemented.) */
  allowUpdates?: boolean;
  /** Any arbitrary primitive value that, when changed, causes the camera to retry moving to its target
   * configuration. (Not yet implemented.) */
  triggerKey?: string | number;
  /** Executes when user tracking mode changes. */
  onUserTrackingModeChange?: UserTrackingModeChangeCallback;
}

interface CameraStop {
  /** Allows static check of the data type. For internal use only. */
  readonly type?: 'CameraStop';
  /** The location on which the map should center. */
  centerCoordinate?: Position;
  /** The corners of a box around which the map should bound. Contains padding props for backwards
   * compatibility; the root `padding` prop should be used instead. */
  bounds?: CameraBoundsWithPadding;
  /** The heading (orientation) of the map. */
  heading?: number;
  /** The pitch of the map. */
  pitch?: number;
  /** The zoom level of the map. */
  zoomLevel?: number;
  /** The viewport padding in points. */
  padding?: CameraPadding;
  /** The duration the map takes to animate to a new configuration. */
  animationDuration?: number;
  /** The easing or path the camera uses to animate to a new configuration. */
  animationMode?: CameraAnimationMode;
}

interface CameraFollowConfig {
  /** The mode used to track the user location on the map. */
  followUserMode?: UserTrackingMode;
  /** Whether the map orientation follows the user location. */
  followUserLocation?: boolean;
  /** The zoom level used when following the user location. */
  followZoomLevel?: number;
  /** The pitch used when following the user location. */
  followPitch?: number;
  /** The heading used when following the user location. */
  followHeading?: number;
}

interface CameraMinMaxConfig {
  /** The lowest allowed zoom level. */
  minZoomLevel?: number;
  /** The highest allowed zoom level. */
  maxZoomLevel?: number;
  /** The corners of a box defining the limits of where the camera can pan or zoom. */
  maxBounds?: {
    ne: Position;
    sw: Position;
  };
}

interface CameraBounds {
  ne: Position;
  sw: Position;
}

interface CameraPadding {
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

interface CameraBoundsWithPadding
  extends CameraBounds,
    Partial<CameraPadding> {}

interface CameraStops {
  readonly type: 'CameraStops';
  stops: CameraStop[];
}

// Native module types.

type NativeAnimationMode = 'flight' | 'ease' | 'linear' | 'none' | 'move';

interface NativeCameraProps extends CameraFollowConfig {
  testID?: string;
  stop: NativeCameraStop | null;
  defaultStop?: NativeCameraStop | null;
  minZoomLevel?: number;
  maxZoomLevel?: number;
  maxBounds?: string | null;
  onUserTrackingModeChange?: UserTrackingModeChangeCallback;
}

interface NativeCameraStop {
  centerCoordinate?: string;
  bounds?: string;
  heading?: number;
  pitch?: number;
  zoom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  duration?: number;
  mode?: NativeAnimationMode;
}

export interface CameraRef {
  setCamera: (config: CameraStop | CameraStops) => void;
  fitBounds: (
    ne: Position,
    sw: Position,
    paddingConfig?: number | number[],
    animationDuration?: number,
  ) => void;
  flyTo: (centerCoordinate: Position, animationDuration?: number) => void;
  moveTo: (centerCoordinate: Position, animationDuration?: number) => void;
  zoomTo: (zoomLevel: number, animationDuration?: number) => void;
}

/**
 * Controls the perspective from which the user sees the map.
 *
 * To use imperative methods, pass in a ref object:
 *
 * <pre>const camera = useRef<CameraRef>(null);
 *
 * useEffect(() => {
 *   camera.current?.setCamera({
 *     centerCoordinate: [lon, lat],
 *   });
 * }, []);
 *
 * return (
 *   \<Camera ref={camera} />
 * );</pre>
 */
const Camera = (props: CameraProps, ref: React.ForwardedRef<CameraRef>) => {
  const {
    centerCoordinate,
    bounds,
    heading,
    pitch,
    zoomLevel,
    padding,
    animationDuration,
    animationMode,
    minZoomLevel,
    maxZoomLevel,
    maxBounds,
    followUserLocation,
    followUserMode,
    followZoomLevel,
    followPitch,
    followHeading,
    defaultSettings,
    allowUpdates = true,
    triggerKey,
    onUserTrackingModeChange,
  } = props;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const camera: React.RefObject<RCTMGLCamera> = useRef(null);

  const nativeDefaultStop = useMemo((): NativeCameraStop | null => {
    if (!defaultSettings) {
      return null;
    }
    const _defaultStop: NativeCameraStop = {
      centerCoordinate: JSON.stringify(defaultSettings.centerCoordinate),
      bounds: JSON.stringify(defaultSettings.bounds),
      heading: defaultSettings.heading ?? 0,
      pitch: defaultSettings.pitch ?? 0,
      zoom: defaultSettings.zoomLevel ?? 11,
      paddingTop: defaultSettings.padding?.paddingTop ?? 0,
      paddingBottom: defaultSettings.padding?.paddingBottom ?? 0,
      paddingLeft: defaultSettings.padding?.paddingLeft ?? 0,
      paddingRight: defaultSettings.padding?.paddingRight ?? 0,
      duration: defaultSettings.animationDuration ?? 2000,
      mode: nativeAnimationMode(defaultSettings.animationMode),
    };
    return _defaultStop;
  }, [defaultSettings]);

  const buildNativeStop = useCallback(
    (
      stop: CameraStop,
      ignoreFollowUserLocation = false,
    ): NativeCameraStop | null => {
      stop = {
        ...stop,
        type: 'CameraStop',
      };

      if (props.followUserLocation && !ignoreFollowUserLocation) {
        return null;
      }

      const _nativeStop: NativeCameraStop = { ...nativeDefaultStop };

      if (stop.pitch !== undefined) _nativeStop.pitch = stop.pitch;
      if (stop.heading !== undefined) _nativeStop.heading = stop.heading;
      if (stop.zoomLevel !== undefined) _nativeStop.zoom = stop.zoomLevel;
      if (stop.animationMode !== undefined)
        _nativeStop.mode = nativeAnimationMode(stop.animationMode);
      if (stop.animationDuration !== undefined)
        _nativeStop.duration = stop.animationDuration;

      if (stop.centerCoordinate) {
        _nativeStop.centerCoordinate = JSON.stringify(
          geoUtils.makePoint(stop.centerCoordinate),
        );
      }

      if (stop.bounds && stop.bounds.ne && stop.bounds.sw) {
        const { ne, sw } = stop.bounds;
        _nativeStop.bounds = JSON.stringify(geoUtils.makeLatLngBounds(ne, sw));
      }

      _nativeStop.paddingTop =
        stop.padding?.paddingTop ?? stop.bounds?.paddingTop ?? 0;
      _nativeStop.paddingRight =
        stop.padding?.paddingRight ?? stop.bounds?.paddingRight ?? 0;
      _nativeStop.paddingBottom =
        stop.padding?.paddingBottom ?? stop.bounds?.paddingBottom ?? 0;
      _nativeStop.paddingLeft =
        stop.padding?.paddingLeft ?? stop.bounds?.paddingLeft ?? 0;

      return _nativeStop;
    },
    [props.followUserLocation, nativeDefaultStop],
  );

  const nativeStop = useMemo(() => {
    return buildNativeStop({
      type: 'CameraStop',
      centerCoordinate,
      bounds,
      heading,
      pitch,
      zoomLevel,
      padding,
      animationDuration,
      animationMode,
    });
  }, [
    centerCoordinate,
    bounds,
    heading,
    pitch,
    zoomLevel,
    padding,
    animationDuration,
    animationMode,
    buildNativeStop,
  ]);

  const nativeMaxBounds = useMemo(() => {
    if (!maxBounds?.ne || !maxBounds?.sw) {
      return null;
    }
    return JSON.stringify(
      geoUtils.makeLatLngBounds(maxBounds.ne, maxBounds.sw),
    );
  }, [maxBounds]);

  const _setCamera: CameraRef['setCamera'] = (config) => {
    if (!config.type)
      // @ts-expect-error The compiler doesn't understand that the `config` union type is guaranteed
      // to be an object type.
      config = {
        ...config,
        // @ts-expect-error Allows JS files to pass in an invalid config (lacking the `type` property),
        // which would raise a compilation error in TS files.
        type: config.stops ? 'CameraStops' : 'CameraStop',
      };

    if (config.type === 'CameraStops') {
      for (const _stop of config.stops) {
        let _nativeStops: NativeCameraStop[] = [];
        const _nativeStop = buildNativeStop(_stop);
        if (_nativeStop) {
          _nativeStops = [..._nativeStops, _nativeStop];
        }
        camera.current.setNativeProps({
          stop: { stops: _nativeStops },
        });
      }
    } else if (config.type === 'CameraStop') {
      const _nativeStop = buildNativeStop(config);
      if (_nativeStop) {
        camera.current.setNativeProps({ stop: _nativeStop });
      }
    }
  };
  const setCamera = useCallback(_setCamera, [buildNativeStop]);

  const _fitBounds: CameraRef['fitBounds'] = (
    ne,
    sw,
    paddingConfig = 0,
    animationDuration = 0,
  ) => {
    let padding = {
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
    };

    if (typeof paddingConfig === 'object') {
      if (paddingConfig.length === 2) {
        padding = {
          paddingTop: paddingConfig[0],
          paddingBottom: paddingConfig[0],
          paddingLeft: paddingConfig[1],
          paddingRight: paddingConfig[1],
        };
      } else if (paddingConfig.length === 4) {
        padding = {
          paddingTop: paddingConfig[0],
          paddingBottom: paddingConfig[2],
          paddingLeft: paddingConfig[3],
          paddingRight: paddingConfig[1],
        };
      }
    } else if (typeof paddingConfig === 'number') {
      padding = {
        paddingTop: paddingConfig,
        paddingBottom: paddingConfig,
        paddingLeft: paddingConfig,
        paddingRight: paddingConfig,
      };
    }

    setCamera({
      type: 'CameraStop',
      bounds: {
        ne,
        sw,
      },
      padding,
      animationDuration,
      animationMode: 'easeTo',
    });
  };
  const fitBounds = useCallback(_fitBounds, [setCamera]);

  const _flyTo: CameraRef['flyTo'] = (
    centerCoordinate,
    animationDuration = 2000,
  ) => {
    setCamera({
      type: 'CameraStop',
      centerCoordinate,
      animationDuration,
    });
  };
  const flyTo = useCallback(_flyTo, [setCamera]);

  const _moveTo: CameraRef['moveTo'] = (
    centerCoordinate,
    animationDuration = 0,
  ) => {
    setCamera({
      type: 'CameraStop',
      centerCoordinate,
      animationDuration,
      animationMode: 'easeTo',
    });
  };
  const moveTo = useCallback(_moveTo, [setCamera]);

  const _zoomTo: CameraRef['zoomTo'] = (
    zoomLevel,
    animationDuration = 2000,
  ) => {
    setCamera({
      type: 'CameraStop',
      zoomLevel,
      animationDuration,
      animationMode: 'flyTo',
    });
  };
  const zoomTo = useCallback(_zoomTo, [setCamera]);

  useImperativeHandle(ref, () => ({
    /**
     * Sets any camera properties, with default fallbacks if unspecified.
     *
     * @example
     * camera.current?.setCamera({
     *   centerCoordinate: [lon, lat],
     * });
     *
     * @param {CameraStop | CameraStops} config
     */
    setCamera,
    /**
     * Set the camera position to enclose the provided bounds, with optional
     * padding and duration.
     *
     * @example
     * camera.fitBounds([lon, lat], [lon, lat]);
     * camera.fitBounds([lon, lat], [lon, lat], [20, 0], 1000);
     *
     * @param {Position} ne Northeast coordinate of bounding box
     * @param {Position} sw Southwest coordinate of bounding box
     * @param {number | number[]} paddingConfig The viewport padding, specified as a number (all sides equal), a 2-item array ([vertical, horizontal]), or a 4-item array ([top, right, bottom, left])
     * @param {number} animationDuration The transition duration
     */
    fitBounds,
    /**
     * Sets the camera to center around the provided coordinate using a realistic 'travel'
     * animation, with optional duration.
     *
     * @example
     * camera.flyTo([lon, lat]);
     * camera.flyTo([lon, lat], 12000);
     *
     *  @param {Position} centerCoordinate The coordinate to center in the view
     *  @param {number} animationDuration The transition duration
     */
    flyTo,
    /**
     * Sets the camera to center around the provided coordinate, with optional duration.
     *
     * @example
     * camera.moveTo([lon, lat], 200);
     * camera.moveTo([lon, lat]);
     *
     *  @param {Position} centerCoordinate The coordinate to center in the view
     *  @param {number} animationDuration The transition duration
     */
    moveTo,
    /**
     * Zooms the camera to the provided level, with optional duration.
     *
     * @example
     * camera.zoomTo(16);
     * camera.zoomTo(16, 100);
     *
     * @param {number} zoomLevel The target zoom
     * @param {number} animationDuration The transition duration
     */
    zoomTo,
  }));

  return (
    <RCTMGLCamera
      testID={'Camera'}
      ref={camera}
      stop={nativeStop}
      defaultStop={nativeDefaultStop}
      followUserLocation={followUserLocation}
      followUserMode={followUserMode}
      followPitch={followPitch}
      followHeading={followHeading}
      followZoomLevel={followZoomLevel}
      minZoomLevel={minZoomLevel}
      maxZoomLevel={maxZoomLevel}
      maxBounds={nativeMaxBounds}
      onUserTrackingModeChange={onUserTrackingModeChange}
    />
  );
};

const RCTMGLCamera =
  requireNativeComponent<NativeCameraProps>(NATIVE_MODULE_NAME);

export default memo(forwardRef(Camera));
