import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { read } from "to-vfile";
import fs from "fs/promises";
import extract from "remark-extract-frontmatter";
import { EXIT, visit } from "unist-util-visit";
import * as yaml from "yaml";
import "dotenv/config";
import * as cloudinary from "cloudinary";
import { Liquid } from "liquidjs";
import remarkGfm from "remark-gfm-no-autolink";
import remarkMdx from "remark-mdx";

const liquidEngine = new Liquid({ jekyllInclude: true });

liquidEngine.registerTag("include", {
  parse(tagToken) {
    this.args = tagToken.args.split(" ");
  },
  render(context, emitter) {
    const index = Math.floor(this.args.length * Math.random());
    emitter.write(this.args[index]);
  },
});

function transformImagePath(path, type) {
  if (!path) return;
  return (`linaro-website/images/${type}/` + path.split("/").slice(-1))
    .split(".")
    .slice(0, -1)
    .join(".")
    .split("?")[0];
}

function transformAuthor(author) {
  return author
    .split("@")[0]
    .toLowerCase()
    .trim()
    .replace(".", "-")
    .replace("_", "-")
    .replace(" ", "-");
}

const tags = [
  { key: "android", name: "Android", migrate: ["Android", "AOSP"] },
  {
    key: "arm",
    name: "Arm",
    migrate: ["Arm", "ARM", "AArch64", "SystemReady"],
  },
  {
    key: "ai-ml",
    name: "AI & ML",
    migrate: ["Artificial Intelligence", "Machine Learning"],
  },
  {
    key: "automotive",
    name: "Automotive",
    migrate: ["Automotive", "Software defined Vehicle"],
  },
  { key: "ci", name: "CI", migrate: ["CI"] },
  {
    key: "datacenter",
    name: "Datacenter",
    migrate: ["Datacenter", "Big Data", "Server"],
  },
  {
    key: "hpc",
    name: "HPC",
    migrate: ["Supercomputing", "HPC", "LINARO FORGE", "Linaro Forge"],
  },
  {
    key: "iot-embedded",
    name: "IOT & Embedded",
    migrate: ["IoT", "Raspberry Pi", "OpenEmbedded", "RockPi4B", "Embedded"],
  },
  {
    key: "linaro-connect",
    name: "Linaro Connect",
    migrate: ["Linaro Connect"],
  },
  {
    key: "linux-kernel",
    name: "Linux Kernel",
    migrate: ["Linux Kernel", "Kernel Development", "Kernel Release", "LKFT"],
  },

  {
    key: "open-source",
    name: "Open Source",
    migrate: [
      "Open Source",
      "Debian",
      "GNU",
      "LLVM",
      "MCUboot",
      "OP-TEE",
      "Rust",
    ],
  },
  { key: "security", name: "Security", migrate: ["Security", "Encryption"] },
  { key: "toolchain", name: "Toolchain", migrate: ["Toolchain", "LAVA"] },
  {
    key: "virtualization",
    name: "Virtualization",
    migrate: ["Virtualization"],
  },
  {
    key: "windows-on-arm",
    name: "Windows on Arm",
    migrate: ["Windows On Arm"],
  },
  { key: "testing", name: "Testing", migrate: ["Testing", "LKFT"] },
  { key: "debugging", name: "Debugging", migrate: ["Debugging"] },
  { key: "u-boot", name: "U-Boot", migrate: ["U-boot", "U-Boot"] },
  { key: "qemu", name: "QEMU", migrate: ["QEMU"] },
];

function transformTag(tag) {
  const newTags = tags.filter((newTag) => newTag.migrate.includes(tag));
  return newTags.map((newTag) => newTag.key);
}

function sleep(time, callback) {
  var stop = new Date().getTime();
  while (new Date().getTime() < stop + time) {}
  callback();
}

const INPUT_FOLDER = "./old_content";
const blogs = await fs.readdir(INPUT_FOLDER);

const recentBlogs = blogs.filter(
  (blog) => !blog.startsWith("2023") && !blog.startsWith("2024")
);

recentBlogs.forEach(async (blog) => {
  const file = await unified()
    .use(remarkParse)

    .use(remarkFrontmatter)
    .use(extract, { yaml: yaml.parse })
    .use(function () {
      return function (tree, file) {
        const { data } = file;

        // fix metadata
        const imagePath = transformImagePath(data.image, "blog");
        const author = transformAuthor(data.author);
        const tags = (data.tags ?? [])
          .map((tag) => transformTag(tag))
          .flat()
          .filter((tag, index, list) => list.indexOf(tag) === index);

        setTimeout(function () {
          cloudinary.v2.uploader
            .upload("./website" + data.image, {
              public_id: imagePath,
              overwrite: false,
              timeout: 60000000,
            })
            .then((result) => {
              if (result.existing === false) {
                console.log(result);
              }
            });
        }, 10000);

        const newData = {
          ...data,
          layout: undefined,
          category: undefined,
          wordpress_id: undefined,
          slug: undefined,
          author: author,
          image: imagePath,
          tags,
          related: [],
          date: new Date(data.date).toISOString(),
        };

        visit(tree, "yaml", (node, index, parent) => {
          parent.children.splice(index, 1, {
            type: "yaml",
            value: yaml.stringify(newData),
          });
          return EXIT;
        });

        visit(tree, "link", (node, index, parent) => {
          if (
            node.type === "link" &&
            (node.url.startsWith("https://") || node.url.startsWith("http://"))
          ) {
            const newNode = {
              ...node,
              title: null,
              value: node.url.replace("https://", "").replace("http://", ""),
            };
            parent.children.splice(index, 1, newNode);
          }

          if (node.type === "link" && node.url.startsWith("mailto:")) {
            const newNode = {
              ...node,
              type: "text",
              value: node.url.replace("mailto:", ""),
            };
            parent.children.splice(index, 1, newNode);
          }
        });

        visit(tree, "image", (node, index, parent) => {
          console.log(node, node.children, parent);
          const image = node.url;
          const imagePath = transformImagePath(image, "blog");
          setTimeout(function () {
            cloudinary.v2.uploader
              .upload("./website" + image, {
                public_id: imagePath,
                overwrite: false,
                timeout: 60000000,
              })
              .then((result) => {
                console.log(result);
                if (result.existing === false) {
                  console.log(result);
                }
              })
              .catch((err) => console.error(err));
          }, 10000);

          const newNode = {
            ...node,
            url: "/" + imagePath,
          };
          parent.children.splice(index, 1, newNode);
        });

        visit(tree, "paragraph", (node, index, parent) => {
          if (node.children[0].value?.startsWith("{% include image.html")) {
            const parsed = liquidEngine.parse(node.children[0].value);
            const { args } = parsed[0];
            const image = args[1].replace("path=", "").replaceAll(`"`, "");
            const imagePath = transformImagePath(image, "blog");
            setTimeout(function () {
              cloudinary.v2.uploader
                .upload("./website" + image, {
                  public_id: imagePath,
                  overwrite: false,
                  timeout: 60000000,
                })
                .then((result) => {
                  if (result.existing === false) {
                    console.log(result);
                  }
                })
                .catch((err) => console.error(err));
            }, 10000);

            const alt = args
              .slice(2)
              .join(" ")
              .replace("alt=", "")
              .replaceAll(`"`, "");

            const newNode = {
              ...node,
              children: [
                {
                  type: "image",
                  alt,
                  url: "/" + imagePath,
                  position: node.children[0].position,
                },
                ...node.children.slice(1),
              ],
            };
            parent.children.splice(index, 1, newNode);
          }
        });
      };
    })
    .use(remarkStringify, { commonMark: true, gfm: true })
    .use(remarkGfm)
    .process(await read(INPUT_FOLDER + "/" + blog));

  await fs.writeFile(
    "./new_content/blogs/" +
      blog.split("-").slice(3).join("-").replace(".md", ".mdx"),
    String(file)
  );
  console.log(blog);

  const file2 = await unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkStringify)
    .process(file);
});

const authors = await fs.readdir("./website/_authors");

// const authors = [];

authors.forEach(async (author) => {
  const file = await unified()
    .use(remarkParse)
    .use(remarkStringify)
    .use(remarkFrontmatter)
    .use(extract, { yaml: yaml.parse })
    .use(function () {
      return function (tree, file) {
        const { data } = file;

        const imagePath = transformImagePath(data.image, "author");
        setTimeout(function () {
          cloudinary.v2.uploader
            .upload("./website" + data.image, {
              public_id: imagePath,
              overwrite: false,
            })
            .then((result) => console.log(result));
        }, 10000);
        // .then((result) => console.log(result));
        const last_name =
          data.last_name === data.first_name ? "" : data.last_name;

        const newData = {
          ...data,
          username: undefined,
          image: imagePath,
          last_name,
        };
        visit(tree, "yaml", (node, index, parent) => {
          parent.children.splice(index, 1, {
            type: "yaml",
            value: yaml.stringify(newData),
          });
          return EXIT;
        });
      };
    })
    .process(await read("./website/_authors/" + author));

  await fs.writeFile(
    "./new_content/authors/" +
      transformAuthor(author.replace(".md", "")) +
      ".md",
    String(file)
  );
});

tags.forEach(async (tag) => {
  const data = {
    name: tag.name,
  };
  const file = yaml.stringify(data);
  await fs.writeFile(
    "./new_content/tags/" + tag.key + ".md",
    `---\n` + String(file) + `---`
  );
});
