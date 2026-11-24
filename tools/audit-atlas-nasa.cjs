(async()=>{const ids=['PIA04866','PIA11141','PIA23791','PIA18182','PIA01492','PIA03149'];
for(const id of ids){try{const j=await(await fetch('https://images-api.nasa.gov/search?nasa_id='+id)).json();const a=j.collection.items[0];console.log(JSON.stringify({id,meta:a?.data[0],links:a?.links}));}catch(e){console.log(id,e.message)}}})().catch(console.error);
