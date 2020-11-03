const express = require("express");
const app = express();
const path  = require("path");
// Copy the .env.example in the root into a .env file in this folder
const env = require("dotenv").config({ path: "./.env" });
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

try {
  app.use(express.static(process.env.STATIC_DIR));
} catch (e) {
  console.log("Missing env file, be sure to copy .env.example to .env");
}

app.use(
  express.json({
    // We need the raw body to verify webhook signatures.
    // Let's compute it only when hitting the Stripe webhook endpoint.
    verify: function(req, res, buf) {
      if (req.originalUrl.startsWith("/webhook")) {
        req.rawBody = buf.toString();
      }
    }
  })
);

app.get("/", (req, res) => {
  const paths = path.resolve(__dirname, 'index.html');
  res.sendFile(paths);
});

app.get("/public-key", (req, res) => {
  res.json({ publicKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.post("/create-setup-intent", async (req, res) => {
  // Create or use an existing Customer to associate with the SetupIntent.
  // The PaymentMethod will be stored to this Customer for later use.
  const customer = await stripe.customers.create({"name" : "pratyush", "email" : "erpratyushmayank@gmail.com"});
console.log('customer',customer);
  res.json(await stripe.setupIntents.create({
    customer: customer.id
  }));
});


app.post("/charge-saved-card",async(req,res)=>{
    const customerId = req.body.customerId;

    const paymentMethods = await stripe.paymentMethods.list({
        customer: `${customerId}`,
        type: 'card',
      });

    const paymentId = paymentMethods.data[0].id;

    try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 1099,
          currency: 'aud',
          customer: `${customerId}`,
          payment_method: paymentId,
          off_session: true,
          confirm: true,
        });
        res.json(paymentIntent);
      } catch (err) {
        // Error code will be authentication_required if authentication is needed
        console.log('Error code is: ', err.code);
        const paymentIntentRetrieved = await stripe.paymentIntents.retrieve(err.raw.payment_intent.id);
        console.log('PI retrieved: ', paymentIntentRetrieved.id);
      }
})


app.post("/create-subscription",async(req,res)=>{
    try{
    
        console.log('pending_setup_intent',req.body.pending_setup_intent);
        const paymentMethod = await stripe.setupIntents.create({
            customer: req.body.customerId
          });
        console.log('paymentMethod',paymentMethod);
    const subscription = await stripe.subscriptions.create({
        
        "customer": req.body.customerId,
        "items": [
          {price: 'price_1HRfqXDEf4IuEiYOFSyrJaOo'},
        ],
        "billing_cycle_anchor" : 1602783215
      });
    

    res.json(subscription);
    }catch(err){
        return res.json(err);
    }
})

app.get("/customer-details",async(req,res)=>{
  res.json(await stripe.customers.retrieve(
    "cus_I2H3ggDKZNUzED"
  ))
})



app.get("/pre-auth",async(req,res)=>{
  const paymentIntent = await stripe.paymentIntents.create({
    amount: 1099,
    currency: 'aud',
    payment_method_types: ['card'],
    payment_method : 'pm_1HSCVnDEf4IuEiYORuskZB90',
    customer : 'cus_I2H3ggDKZNUzED',
    capture_method: 'manual',
  });

  res.json(paymentIntent);
})

app.get("/capture-payment",async(req,res)=>{
 // const intent = await stripe.paymentIntents.capture('pi_1HSCwJDEf4IuEiYO1ZXIKdB2');
 const intent = await stripe.paymentIntents.update('pi_1HSCwJDEf4IuEiYO1ZXIKdB2',{"status": "requires_capture"});
  res.json(intent);
})
// Webhook handler for asynchronous events.
app.post("/webhook", async (req, res) => {
  let data;
  let eventType;

  // Check if webhook signing is configured.
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    let signature = req.headers["stripe-signature"];

    try {
      event = await stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`);
      return res.sendStatus(400);
    }
    // Extract the object from the event.
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  if (eventType === "setup_intent.created") {
    console.log(`🔔  A new SetupIntent is created. ${data.object.id}`);
  }

  if (eventType === "setup_intent.setup_failed") {
    console.log(`🔔  A SetupIntent has failed to set up a PaymentMethod.`);
  }

  if (eventType === "setup_intent.succeeded") {
    console.log(
      `🔔  A SetupIntent has successfully set up a PaymentMethod for future use.`
    );
  }

  if (eventType === "payment_method.attached") {
    console.log(
      `🔔  A PaymentMethod ${data.object.id} has successfully been saved to a Customer ${data.object.customer}.`
    );

    // At this point, associate the ID of the Customer object with your
    // own internal representation of a customer, if you have one.

    // Optional: update the Customer billing information with billing details from the PaymentMethod
    const customer = await stripe.customers.update(
      data.object.customer,
      {email: data.object.billing_details.email}, 
      () => {
        console.log(
          `🔔  Customer successfully updated.`
        );
      }
    );

  }

  res.sendStatus(200);
});

const calculateOrderAmount = items => {
  // Replace this constant with a calculation of the order's amount
  // You should always calculate the order total on the server to prevent
  // people from directly manipulating the amount on the client
  return 1400;
};

app.post("/pay", async (req, res) => {
  const { paymentMethodId, paymentIntentId, items, currency , customerId} = req.body;
  console.log('customer',customerId);
  const orderAmount = calculateOrderAmount(items);

  try {
    let intent;
    if (!paymentIntentId) {
      // Create new PaymentIntent
      intent = await stripe.paymentIntents.create({
        amount: orderAmount,
        currency: currency,
        payment_method: paymentMethodId,
        confirmation_method: "manual",
        customer : customerId,
        capture_method: "manual",
        confirm: true
      });
    } else {
      // Confirm the PaymentIntent to place a hold on the card
      intent = await stripe.paymentIntents.confirm(paymentIntentId);
    }

    if (intent.status === "requires_capture") {
      console.log("❗ Charging the card for: " + intent.amount_capturable);
      // Because capture_method was set to manual we need to manually capture in order to move the funds
      // You have 7 days to capture a confirmed PaymentIntent
      // To cancel a payment before capturing use .cancel() (https://stripe.com/docs/api/payment_intents/cancel)
      intent = await stripe.paymentIntents.capture(intent.id);
    }

    const response = generateResponse(intent);
    res.send(response);
  } catch (e) {
    // Handle "hard declines" e.g. insufficient funds, expired card, etc
    // See https://stripe.com/docs/declines/codes for more
    res.send({ error: e.message });
  }
});

const generateResponse = intent => {
  // Generate a response based on the intent's status
  switch (intent.status) {
    case "requires_action":
    case "requires_source_action":
      // Card requires authentication
      return {
        requiresAction: true,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret
      };
    case "requires_payment_method":
    case "requires_source":
      // Card was not properly authenticated, suggest a new payment method
      return {
        error: "Your card was denied, please provide a new payment method"
      };
    case "succeeded":
      // Payment is complete, authentication not required
      // To cancel the payment after capture you will need to issue a Refund (https://stripe.com/docs/api/refunds)
      console.log("💰 Payment received!");
      return { clientSecret: intent.client_secret };
  }
};

app.listen(4242, () => console.log(`Node server listening on port ${4242}!`));
