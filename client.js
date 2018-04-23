'use strict'

const modbus = require('jsmodbus')
const parseArgs = require('minimist')
const argv = parseArgs(
  process.argv.slice(2),
  {
    boolean: true,
    string: ["discretes", "coils","inputs","holdings"],
    alias: {h: 'help', c: 'compact', s: 'supercompact',w: "write"}, 
    default : {
        help: false, 
        compact: false, supercompact: false,
        discretes: "",    
        coils: "",
        inputs: "",
        holdings: "",
        write: false
    }
})

const hostArray = argv._[0].split(":")
const host = hostArray[0]
const port = hostArray[1] || 502
const map = argv._[2] || "empty" 

let mapList = {}
mapList.C221 = require('./maps/C221.js')
mapList.vm227 = require('./maps/vm227.js')
const currentMap = mapList[map]

const onConnect = (c) =>  {new Promise((resolve, reject) => {
    c.on('connect', () => resolve())
})}
 
const registerInfo = Object.keys(currentMap.registers).reduce((previous, current) => {
    previous[current] = currentMap.registers[current]
    .reduce((obj, val, i, a) => {
        obj[i] = val
        return obj
        }, {})
    return previous
}, {})
const filters = {coils:argv["coils"] ? argv["coils"].split(",").map( x =>  parseInt(x)) : [],
discretes: argv["discretes"] ? argv["discretes"].split(",").map( x =>  parseInt(x)) : [],
inputs: argv["inputs"] ? argv["inputs"].split(",").map( x =>  parseInt(x)) : [],
holdings: argv["holdings"] ? argv["holdings"].split(",").map( x =>  parseInt(x)) : []
}
let isFiltered = false 
for (let i in filters) {
    if (filters[i].length > 0) isFiltered = true 
} 
const registers = Object.keys(currentMap.registers).reduce(function(previous, current) {
    previous[current] = currentMap.registers[current].
    filter(x => {
        if (isFiltered) return filters[current].indexOf(x.register) > -1 ? true : false
        else if ( argv.supercompact) return x.supercompact ? true : false 
        else if ( argv.compact) return (x.supercompact || x.compact ) ? true: false
        return true
    })
    .reduce((arr, val, i, a) => {
        if (!i || parseInt(val.register) !== parseInt(a[i - 1].register) + 1) arr.push(
            [val.register, 0, []]);
        arr[arr.length - 1][1] += 1 
        arr[arr.length - 1][2].push(val);
        return arr;
      }, [])
    return previous;
}, {});

const formatRegisters = function(v,value) {
    if (value === true) return "Till"
    if (value === false) return "Från"
    if (v.status && v.status[value]) { 
        value = v.status[value] +" (" + value +")" }
    else {
        value= v.scale ? (value / ((1/v.scale))) : value
        value = value + " "+(v.unit || "")
    }
    return value
}

const printClient = (result,ID) => {
    console.log(
    `läser från ${host}:${port} ID:${ID} (mall:${map}) 
    `)
    for (let [type, desc] of [  ['coils', 'Coils'] ,
                                ['discretes','DiscreteInputs'],
                                ['inputs','InputRegisters'],
                                ['holdings','HoldingRegisters']]) 
    {

        if (Object.keys(result[type]).length > 0) {
            console.log(desc)
            console.log(Object.entries(result[type]).map(x => {
                return `${x[0]} = ${formatRegisters(registerInfo[type][x[0]] ,x[1].value)}, ${x[1].desc}` 
            }).reduce((prev,curr) => prev+curr+"\n", ""))
        }
       
    }
    
}
const callClient = async function(ID) {
    let result = {coils:{},discretes:{},inputs:{}, holdings:{}}
    let client = modbus.client.tcp.complete({ 
        'host'              : host, 
        'port'              : port,
        'autoReconnect'     : true,
        'reconnectTimeout'  : 1000,
        'timeout'           : 5000,
        'unitId'            : ID
    })

    client.connect()
    await onConnect(client)
    for (let [type, func] of [  ['coils', 'readCoils'] ,
                        ['discretes','readDiscreteInputs'],
                        ['inputs','readInputRegisters'],
                        ['holdings','readHoldingRegisters']]) {
        for (let [first, num, regs]  of registers[type]) {
            const response = await client[func](first,num)
            const holder = (type === 'coils' || type === 'discretes') ? 'coils' : 'register'
            for (let i = 0; i < num ; i++) {
                i = parseInt(i)
                result[type][first+i] = {value: response[holder][i], desc: 
                    registerInfo[type][first+i].desc}
            }
        }
    }
   
    client.close()
    printClient(result,ID)
    }


let unitId = argv._[1]
if ((unitId+"").indexOf("-") >-1) {  
    const [start, finish] = (unitId+"").split("-")
    unitId = []
    for (let i = start; i <= finish ; i++) {
        unitId.push(i) 
    }
} else {
    unitId = (unitId+"").split(",")
}
for (const ID of unitId) callClient(ID)

