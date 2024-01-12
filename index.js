require("dotenv").config();
const cities = require("all-the-cities");
const fetch = require("node-fetch");
const fs = require("fs");
const { BskyAgent, RichText } = require("@atproto/api");
const {
  placeDetails,
} = require("@googlemaps/google-maps-services-js/dist/places/details");

const apiKey = "AIzaSyAdhba-eMrucGzc16Qux3EsCpsJlcZwgs0";

function rando(array) {
  const index = Math.floor(Math.random() * array.length);
  return array[index];
}

function getLocation() {
  return new Promise(async (resolve, reject) => {
    const places = cities.filter(city => city.population > 50000);
    const place = rando(places);
    resolve(place.loc.coordinates);
  });
}

async function searchNearby(placeCoordinates) {
  const nearPlaces = await fetch(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${placeCoordinates[1]},${placeCoordinates[0]}&radius=20000&key=${apiKey}`
  );
  const places = await nearPlaces.json(); // idk why you have to await this but you do
  return places.results;
}

function selectPlace(arr) {
  arr.shift();
  const filtered = arr.filter(
    place =>
      place.user_ratings_total &&
      !place.name.includes("Hotel") &&
      !place.types.includes("lodging") &&
      !place.types.includes("gas_station")
  );
  const noRatings = arr.filter(place => !place.user_ratings_total);
  const sorted = filtered.sort((a, b) => {
    return a.user_ratings_total - b.user_ratings_total;
  });
  const reversed = sorted.reverse();
  const concated = [...reversed, ...noRatings];
  concated.length = 5;
  return rando(concated);
}

async function getDetails(obj) {
  console.log(obj);
  if (obj?.place_id) {
    const details = await placeDetails({
      params: {
        key: apiKey,
        place_id: obj.place_id,
        fields: ["photos", "formatted_address"],
      },
      timeout: 1000,
    });
    return {
      details_photos: details.data.result.photos,
      formatted_address: details.data.result.formatted_address,
      ...obj,
    };
  } else {
    composeBot();
    throw new Error("details no obj?.place_id");
  }
}

function shufflePhotos(obj) {
  if (!obj.details_photos) {
    composeBot();
    throw new Error("No detail photos");
  }
  const shuffledPhotos = obj.details_photos.sort(() => Math.random() - 0.5);
  return {
    ...obj,
    shuffledPhotos,
  };
}

const writeFile = (uri, data, options) =>
  new Promise((resolve, reject) => {
    fs.writeFile(uri, data, err => {
      if (err) {
        return reject(`Error writing file: ${uri} --> ${err}`);
      }
      resolve(`Successfully wrote file`);
    });
  });

async function getDetailImages(obj) {
  const numberOfPhotosRequested =
    obj.shuffledPhotos.length > 4 ? 4 : obj.shuffledPhotos.length;
  const photos = obj.shuffledPhotos.slice(0, numberOfPhotosRequested);
  let i = 1;
  for (const photo of photos) {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/photo?maxwidth=640&photoreference=${photo.photo_reference}&key=${apiKey}`
    );
    const buffer = await response.buffer();
    await writeFile(`./image${i}.jpg`, buffer);
    i++;
  }
  return { ...obj, numberOfPhotosRequested };
}

async function postPost(obj) {
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: process.env.IDENTIFIER,
    password: process.env.PASSWORD,
  });

  const blobs = [];
  for (let i = 1; i <= obj.numberOfPhotosRequested; i++) {
    const data = require("fs").readFileSync(`./image${i}.jpg`);
    const upload = await agent.uploadBlob(data, { encoding: "image/jpg" });
    blobs.push({
      image: upload.data.blob,
      alt: `Photo of ${obj.name} sourced from google maps`,
    });
  }
  const prominence = obj.user_ratings_total ? obj.user_ratings_total : 0;
  const rt = new RichText({
    text: `${obj.name}; ${obj.formatted_address}; Prominence: ${prominence};  https://www.google.com/maps/search/?api=1&query=${obj.geometry.location.lat}%2C${obj.geometry.location.lng}&query_place_id=${obj.place_id}`,
  });
  await rt.detectFacets(agent);
  const result = await agent.post({
    $type: "app.bsky.feed.post",
    text: rt.text,
    facets: rt.facets,
    embed: {
      images: blobs,
      $type: "app.bsky.embed.images",
    },
    createdAt: new Date().toISOString(),
  });
  return result;
}

async function composeBot() {
  getLocation()
    .then(r => searchNearby(r))
    .then(r => selectPlace(r))
    .then(r => getDetails(r))
    .then(r => shufflePhotos(r))
    .then(r => getDetailImages(r))
    .then(r => postPost(r))
    .then(r => console.log("DONE", r))
    .catch(e => {
      console.log("err", e.message);
    });
}

composeBot();
