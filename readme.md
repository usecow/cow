# Jin Server

Welcome to the Jin Server, a new server-side scripting language designed for web development. With Jin, you can create dynamic and interactive web applications by seamlessly embedding JavaScript and TypeScript code directly into HTML documents, all with a minimal learning curve.

Jin is more than just a scripting language; it includes both the runtime environment (Jin Interpreter) and a built-in web server (powered by Node.js). This integrated approach simplifies your development workflow, reducing the learning curve and enabling rapid web application development.

## Features

- **File-Based Routing**: Jin adopts a file-based routing approach. Each URL corresponds to a specific Jin file or script. When a request is made to a particular URL, the web server effortlessly maps it to the corresponding Jin script.

- **JavaScript and TypeScript Support**: With Jin, you have the freedom to choose between JavaScript and TypeScript based on your project's requirements. Write your web pages using the language that best suits your needs at any given moment.

- **Embedded HTML Integration**: Seamlessly embed JavaScript and TypeScript blocks directly within your HTML code. This feature makes it a breeze to create dynamic and interactive web applications that engage users.

- **Server-Side Processing**: Jin takes care of server-side processing for you. The code within Jin files is executed on the server before the HTML page is sent to the client. This enables server-side data processing, making dynamic content generation a breeze.

- **Rapid Development**: Jin is perfect for rapid application development. It simplifies prototyping and speeds up development, making it particularly well-suited for smaller projects where efficiency matters.

## Getting Started

To get started with Jin, follow these simple steps:

1. **Installation**: Install the Jin CLI globally using npm.

   ```sh
   $ npm install -g @jin/jin
   ```

2. **Create a Project**: Create a new Jin project or navigate to an existing project directory.

3. **Start the Server**: Launch the Jin server from your project directory.

   ```sh
   $ jin ./src
   ```

Now you're all set to start developing with Jin!

## Documentation

For detailed documentation, examples, and usage guidelines, please refer to our comprehensive [Jin Documentation](docs).

## Contributing

We welcome contributions from the community! If you'd like to get involved in the development of Jin or have any feedback, please check our [Contribution Guidelines](CONTRIBUTING.md).

## License

Jin is open-source software licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contact

For questions, support, or inquiries, feel free to reach out to our team at [nijikokun@gmail.com](mailto:nijikokun@gmail.com).