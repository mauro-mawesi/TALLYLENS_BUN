import vision from "@google-cloud/vision";

// Cliente usando la variable GOOGLE_APPLICATION_CREDENTIALS
const client = new vision.ImageAnnotatorClient();

async function main() {
    const [result] = await client.textDetection(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/ReceiptSwiss.jpg/800px-ReceiptSwiss.jpg"
    );
    const detections = result.textAnnotations;

    console.log("Texto detectado:");
    console.log(detections[0]?.description || "Nada detectado");
}

main().catch(console.error);
