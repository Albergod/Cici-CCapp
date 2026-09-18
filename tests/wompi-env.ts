// Se importa PRIMERO en wompi-flow.test.ts para fijar las llaves de Wompi
// antes de que src/lib/wompi.ts se evalúe (lee process.env al cargarse).
// Llaves ficticias de prueba: el fetch a Wompi está mockeado en el test.
process.env.WOMPI_PUBLIC_KEY = "pub_test_fake";
process.env.WOMPI_PRIVATE_KEY = "prv_test_fake";
process.env.WOMPI_INTEGRITY_KEY = "test_integrity_fake";
process.env.WOMPI_EVENTS_KEY = "test_events_fake";
process.env.WOMPI_SANDBOX = "true";
