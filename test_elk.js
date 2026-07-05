const ELK = require('elkjs');

const elk = new ELK();

const graph = {
  id: "root",
  layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '40' },
  children: [
    { id: "n1", width: 100, height: 50 },
    { id: "n2", width: 100, height: 50 },
    {
        id: "n3",
        children: [
            { id: "n3a", width: 100, height: 50 }
        ],
        layoutOptions: { 'elk.padding': '[top=40,left=20,bottom=20,right=20]' }
    }
  ],
  edges: [
    { id: "e1", sources: [ "n1" ], targets: [ "n2" ] },
    { id: "e2", sources: [ "n2" ], targets: [ "n3a" ] }
  ]
};

elk.layout(graph)
  .then(res => console.log(JSON.stringify(res, null, 2)))
  .catch(console.error);
