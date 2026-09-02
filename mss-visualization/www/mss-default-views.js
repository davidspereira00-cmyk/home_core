export const defaultViews = [
  {
    id: 'mss-card-test-view',
    name: 'MSS Test View',
    imageUrl: '/local/views/body.jpg',

    overlays: [
      {
        id: 'mss-card-overlay-product',
        name: 'Identification',
        pointerVisible: true,

        position: {
          x: 2.0796621381791893,
          y: 9.610776944584977,
        },

        pointer: {
          x: 38.53119597716387,
          y: 18.397388410151187,
        },

        elements: [
          {
            id: 'mss-card-element-product',
            name: 'Product ID',
            path: 'sensor.mss_report',
            fontSize: 14,
            elementType: 0,
            dataPath: 'rootNode.Identification.ProductId',
          },
          {
            id: 'mss-card-element-station',
            name: 'Station ID',
            path: 'sensor.mss_report',
            fontSize: 14,
            elementType: 0,
            dataPath: 'rootNode.Identification.StationId',
          },
          {
            id: 'mss-card-element-status',
            name: 'Station A',
            path: 'sensor.mss_report',
            fontSize: 14,
            elementType: 1,
            operator: 'equals',
            compareValue: 'A',
            trueText: 'OK',
            falseText: 'NOK',
            dataPath: 'rootNode.Identification.ControlPlan',
          },
        ],

        size: {
          width: 170,
          height: 60,
        },

        pointerSize: 6,
        referenceLineThickness: 5,
      },

      {
        id: 'mss-card-overlay-status',
        name: 'Machine Status',
        pointerVisible: true,

        position: {
          x: 99.8720324549613,
          y: 80.77842867150538,
        },

        pointer: {
          x: 23.833865823584247,
          y: 81.29537635731155,
        },

        elements: [
          {
            id: 'mss-card-element-machine-status',
            name: 'Status',
            path: 'sensor.mss_report',
            fontSize: 14,
            elementType: 0,
            dataPath:
              'rootNode.SystemHealthMSS.AverageCPUUsageLastMeasurement.#text',
            operator: 'equals',
            compareValue: '4',
            trueText: 'OK',
            falseText: 'NOK',
          },
        ],

        size: {
          width: 266.7271728515625,
          height: 99.09088134765625,
        },

        referenceLineThickness: 4,
        pointerSize: 13,
      },

      {
        id: 'mss-overlay-1786544165689',
        name: 'New Overlay',
        pointerVisible: true,

        position: {
          x: 88.129232585283,
          y: 11.946919229942203,
        },

        size: {
          width: 220,
          height: 120,
        },

        pointer: {
          x: 55,
          y: 55,
        },

        pointerSize: 10,
        referenceLineVisible: true,
        referenceLineThickness: 5,

        elements: [],
      },
    ],

    viewerScale: 1,
  },

  {
    id: 'mss-view-1786445690858',
    name: 'New View',
    imageUrl: '/local/views/body.jpg',
    viewerScale: 1,
    overlays: [],
  },
];
